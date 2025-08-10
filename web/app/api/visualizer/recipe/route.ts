import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { VisualizerRecipe } from "@/types/visualizer";
import { cacheGetOrSet } from "@/lib/cache";

// Accept minimal input; server will enrich using Spotify API
const inputSchema = z.object({
  spotifyId: z.string(),
  // Optional legacy fields for backward compatibility
  title: z.string().optional(),
  artist: z.string().optional(),
  spotifyMeta: z.record(z.any()).optional(),
  includeAnalysis: z.boolean().optional(),
  skipEnrichment: z.boolean().optional(),
});

// A structured recipe that instructs the frontend how to build a model and shader
// Minimal, fast to evaluate, and fully local in the client.
// Use shared type

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const {
    spotifyId,
    title: legacyTitle,
    artist: legacyArtist,
    spotifyMeta: legacyMeta,
    includeAnalysis,
    skipEnrichment,
  } = parsed.data;

  // Try to enrich with Spotify server-side using user session
  const session = await getServerSession(authOptions).catch(() => null);
  const accessToken = (session as unknown as { accessToken?: string })
    ?.accessToken;

  type SpotifyTrack = {
    id: string;
    name: string;
    explicit?: boolean;
    popularity?: number;
    duration_ms?: number;
    preview_url?: string | null;
    album?: { id?: string; name?: string; release_date?: string };
    artists?: { id?: string; name?: string }[];
  };

  let track: SpotifyTrack | null = null;
  let features: Record<string, unknown> | null = null;
  let analysis: Record<string, unknown> | null = null;
  let artistsDetailed: Array<Record<string, unknown>> = [];
  let albumDetailed: Record<string, unknown> | null = null;

  if (accessToken && !skipEnrichment) {
    try {
      // Fetch core Spotify data in parallel
      const trackUrl = `https://api.spotify.com/v1/tracks/${encodeURIComponent(
        spotifyId
      )}`;
      const featuresUrl = `https://api.spotify.com/v1/audio-features/${encodeURIComponent(
        spotifyId
      )}`;
      const [trackRes, featuresRes] = await Promise.all([
        fetch(trackUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        }),
        fetch(featuresUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        }),
      ]);

      if (trackRes.ok) track = (await trackRes.json()) as SpotifyTrack;
      if (featuresRes.ok)
        features = (await featuresRes.json()) as Record<string, unknown>;

      // Optional audio analysis (heavier payload)
      if (includeAnalysis) {
        const analysisUrl = `https://api.spotify.com/v1/audio-analysis/${encodeURIComponent(
          spotifyId
        )}`;
        const analysisRes = await fetch(analysisUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (analysisRes.ok)
          analysis = (await analysisRes.json()) as Record<string, unknown>;
      }

      // Enrich artists and album
      const artistIds = (track?.artists ?? [])
        .map((a) => a.id)
        .filter(Boolean) as string[];
      if (artistIds.length) {
        const artistsUrl = `https://api.spotify.com/v1/artists?ids=${artistIds
          .map(encodeURIComponent)
          .join(",")}`;
        const aRes = await fetch(artistsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (aRes.ok) {
          const aJson = (await aRes.json()) as {
            artists?: Array<Record<string, unknown>>;
          };
          artistsDetailed = aJson.artists ?? [];
        }
      }
      const albumId = track?.album?.id;
      if (albumId) {
        const albumUrl = `https://api.spotify.com/v1/albums/${encodeURIComponent(
          albumId
        )}`;
        const alRes = await fetch(albumUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (alRes.ok)
          albumDetailed = (await alRes.json()) as Record<string, unknown>;
      }
    } catch {
      // Ignore enrichment errors; we'll fall back to provided meta
    }
  }

  // Assemble comprehensive context
  type LegacyMeta = Partial<{
    title: string;
    artist: string;
    explicit: boolean;
    duration_ms: number;
    popularity: number;
    preview_url: string | null;
    features: Record<string, unknown>;
  }>;
  const lm: LegacyMeta = (legacyMeta ?? {}) as LegacyMeta;

  const fullContext = {
    core: {
      spotifyId,
      title: track?.name ?? legacyTitle ?? lm.title ?? "",
      artist:
        (track?.artists ?? [])
          .map((a) => a?.name)
          .filter(Boolean)
          .join(", ") ||
        legacyArtist ||
        lm.artist ||
        "",
      explicit: track?.explicit ?? lm.explicit ?? false,
      duration_ms: track?.duration_ms ?? lm.duration_ms,
      popularity: track?.popularity ?? lm.popularity,
      preview_url: track?.preview_url ?? lm.preview_url ?? null,
    },
    album: {
      ...(track?.album || {}),
      ...(albumDetailed || {}),
    },
    artists: artistsDetailed,
    audio_features: features ?? lm.features ?? {},
    audio_analysis: analysis ?? undefined,
  };

  const system = `You are a concise visual art director. You output a single JSON object following the schema provided by the user, with no extra prose. Design a visualizer concept that is vivid, iconic, thematically tied to the song's lore/lyrics/artwork when relevant, and feasible with primitive geometry + a small deformation shader. Prefer procedurally constructible geometries.`;

  const schemaHint = `Schema to follow (TypeScript):
 type VisualizerRecipe = {
   // Short, vivid text seed for procedural generation (5-12 tokens, avoid punctuation)
   seed?: string;
   concept: string;
   rationale: string;
   baseGeometry: "sphere" | "box" | "plane" | "torus" | "cylinder" | "custom";
    // If baseGeometry is "custom", set customKind to one of:
    //   "sunglasses" | "lightbulb" | "heart" | "star" | "bolt" | "vinyl" | "music_note"
    // Keep baseParams minimal numeric params (e.g., sizes, thickness) that the client can interpret.
    customKind?: "sunglasses" | "lightbulb" | "heart" | "star" | "bolt" | "vinyl" | "music_note";
   baseParams: Record<string, number>;
   colorPalette: string[]; // 3-5 hex colors
   textureIdea?: string;
   deformation:
     | { type: "noise"; amplitude: number; frequency: number }
     | { type: "spike"; spikes: number; amplitude: number }
     | { type: "wave"; axis: "x" | "y" | "z"; amplitude: number; frequency: number };
   audioMapping: {
     fftBands: { low: number; mid: number; high: number };
     spotifyWeights: Partial<{
       energy: number; valence: number; danceability: number; tempo: number; loudness: number; acousticness: number; instrumentalness: number; liveness: number; speechiness: number;
     }>;
   };
 };`;

  const researchHint = `Use the provided Spotify data. If your tools allow, briefly research the song/artist on the web (official artwork, themes, lyrics, notable motifs) and reflect that in concept and color palette. Keep output strictly as JSON.`;

  const fastUser = `Title: ${fullContext.core.title}\nArtist: ${fullContext.core.artist}\n\n${schemaHint}\n\nTask: Produce a compact JSON recipe for a 3D visualizer. Choose one baseGeometry or a supported custom metaphor. Keep it minimal and feasible with one vertex deformation. Provide 3-5 hex colors, and an audioMapping with fftBands and some spotifyWeights (best guess).`;
  const richUser = `Input Spotify context (JSON):\n${JSON.stringify(
    fullContext,
    null,
    2
  )}\n\n${schemaHint}\n\nTask: Produce a JSON recipe for a 3D visualizer. Keep it minimal but expressive. Choose one baseGeometry. Prefer iconic metaphors strongly tied to the track (e.g., for Blinding Lights → sunglasses or lightbulb; for vinyl-themed tracks → vinyl). If the metaphor applies, set baseGeometry to "custom" and pick an appropriate customKind from the supported list; otherwise use a primitive. Use a deformation that can be implemented in a single vertex shader. Map audio features to parameters (provide spotifyWeights reflecting the relevance of energy/danceability/valence/tempo etc.). Provide 3-5 hex colors in colorPalette. Additionally, provide a concise 'seed' string capturing the song's visual essence (5-12 tokens, no punctuation) to drive procedural shape variation. Keep output compliant with the provided schema. ${researchHint}`;

  // If no API key, return a deterministic fallback recipe, still functional
  if (!process.env.OPENAI_API_KEY) {
    const fallback: VisualizerRecipe = {
      seed: `${(fullContext.core.title || "Track").replace(
        /[^a-zA-Z0-9\s]/g,
        ""
      )} ${(fullContext.core.artist || "").split(",")[0] || ""}`.trim(),
      concept: `${fullContext.core.title || "Track"} – iconic minimal form`,
      rationale:
        "Fallback: sphere deformed by audio energy and Spotify weights.",
      baseGeometry: "sphere",
      baseParams: { radius: 1.1, widthSegments: 192, heightSegments: 192 },
      colorPalette: ["#9C27B0", "#03A9F4", "#FFFFFF"],
      deformation: { type: "noise", amplitude: 0.35, frequency: 2.2 },
      audioMapping: {
        fftBands: { low: 2, mid: 24, high: 96 },
        spotifyWeights: { energy: 0.6, danceability: 0.25, valence: 0.15 },
      },
    };
    return NextResponse.json(fallback);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // Normalize model aliases; user may set OPENAI_MODEL=gpt5 or gpt-5
  const normalizeModel = (raw: string | undefined): string => {
    const v = (raw ?? "gpt-5").trim().toLowerCase();
    if (v === "gpt5" || v === "gpt 5") return "gpt-5";
    return v;
  };
  let model = normalizeModel(process.env.OPENAI_MODEL);
  if (skipEnrichment) {
    // Prefer a faster model when low-latency is desired
    const fastEnv = (process.env.OPENAI_FAST_MODEL || "").trim();
    if (fastEnv) model = normalizeModel(fastEnv);
    // If no fast model is provided, keep the default model
  }

  const jsonFormat = { type: "json_object" } as const;
  try {
    // Cache key based on spotifyId and flags that alter the prompt/model
    const cacheKey = `recipe:${spotifyId}:analysis:${includeAnalysis ? 1 : 0}:skip:${skipEnrichment ? 1 : 0}`;
    const ttlMs = parseInt(process.env.RECIPE_CACHE_TTL_MS || "600000", 10); // default 10 min

    const result = await cacheGetOrSet<VisualizerRecipe>(cacheKey, ttlMs, async () => {
      const messages = [
        { role: "system", content: system },
        { role: "user", content: skipEnrichment ? fastUser : richUser },
      ] as const;

      // Apply a short timeout for fast path; on timeout, fall back to a local recipe
      const timeoutMs = skipEnrichment
        ? parseInt(process.env.OPENAI_FAST_TIMEOUT_MS || "8000", 10)
        : 0;

      const completionPromise = openai.chat.completions.create({
        model,
        messages: messages as any,
        response_format: jsonFormat as unknown as { type: "json_object" },
        max_tokens: 450,
        temperature: 0.4,
      });

      const completionAny: any = timeoutMs > 0
        ? await Promise.race([
            completionPromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("openai_timeout")), timeoutMs)
            ),
          ])
        : await completionPromise;

      const content = completionAny.choices[0]?.message?.content || "{}";

      let recipe: VisualizerRecipe | null = null;
      try {
        recipe = JSON.parse(content);
      } catch {
        // fallback minimal recipe when JSON parsing fails
        const fallbackTitle = fullContext.core.title || legacyTitle || "Track";
        recipe = {
          seed: `${fallbackTitle}`.replace(/[^a-zA-Z0-9\s]/g, ""),
          concept: `${fallbackTitle}`,
          rationale: "Fallback minimal sphere with noise deformation.",
          baseGeometry: "sphere",
          baseParams: { radius: 1, widthSegments: 128, heightSegments: 128 },
          colorPalette: ["#ffffff", "#222222", "#ff4081"],
          deformation: { type: "noise", amplitude: 0.3, frequency: 2.5 },
          audioMapping: {
            fftBands: { low: 2, mid: 32, high: 128 },
            spotifyWeights: { energy: 0.6, valence: 0.2, danceability: 0.2 },
          },
          fallbackPrompt: "openai_json_parse_error",
        } as any;
      }

      return recipe as VisualizerRecipe;
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    // On OpenAI API failure, return a deterministic fallback with a hint
    const fallbackTitle = fullContext.core.title || legacyTitle || "Track";
    const fallback: VisualizerRecipe = {
      seed: `${fallbackTitle}`.replace(/[^a-zA-Z0-9\s]/g, ""),
      concept: `${fallbackTitle} – resilient fallback`,
      rationale:
        "OpenAI call failed; serving minimal recipe so UI still works.",
      baseGeometry: "sphere",
      baseParams: { radius: 1.05, widthSegments: 160, heightSegments: 160 },
      colorPalette: ["#8e44ad", "#2980b9", "#ecf0f1"],
      deformation: { type: "noise", amplitude: 0.32, frequency: 2.3 },
      audioMapping: {
        fftBands: { low: 2, mid: 28, high: 112 },
        spotifyWeights: { energy: 0.6, danceability: 0.25, valence: 0.15 },
      },
      fallbackPrompt: `openai_error:${(err as Error)?.message ?? "unknown"}`,
    };
    return NextResponse.json(fallback);
  }
}
