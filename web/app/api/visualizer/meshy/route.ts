import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const inputSchema = z.object({
  spotifyId: z.string(),
  includeAnalysis: z.boolean().optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { spotifyId, includeAnalysis } = parsed.data;

  // Enrich with Spotify like the recipe route
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

  if (accessToken) {
    try {
      const [tRes, fRes] = await Promise.all([
        fetch(
          `https://api.spotify.com/v1/tracks/${encodeURIComponent(spotifyId)}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
          }
        ),
        fetch(
          `https://api.spotify.com/v1/audio-features/${encodeURIComponent(
            spotifyId
          )}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
          }
        ),
      ]);
      if (tRes.ok) track = (await tRes.json()) as SpotifyTrack;
      if (fRes.ok) features = (await fRes.json()) as Record<string, unknown>;

      if (includeAnalysis) {
        const aRes = await fetch(
          `https://api.spotify.com/v1/audio-analysis/${encodeURIComponent(
            spotifyId
          )}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
          }
        );
        if (aRes.ok) analysis = (await aRes.json()) as Record<string, unknown>;
      }
    } catch {
      // swallow
    }
  }

  const fullContext = {
    core: {
      spotifyId,
      title: track?.name ?? "",
      artist:
        (track?.artists ?? [])
          .map((a) => a?.name)
          .filter(Boolean)
          .join(", ") ?? "",
      explicit: track?.explicit ?? false,
      duration_ms: track?.duration_ms,
      popularity: track?.popularity,
      preview_url: track?.preview_url ?? null,
    },
    album: track?.album ?? {},
    audio_features: features ?? {},
    audio_analysis: analysis ?? undefined,
  };

  const system = `You are a senior 3D artist expert at prompting Meshy (text-to-3D). Output ONLY a single-line prompt.`;

  const guidelines = `Format strictly: "<Artist> — <2-4 words>".
  - Put the primary artist name FIRST (e.g., "Drake — ...").
  - After the dash, use only 2-4 short words: a concrete object or motif + 1-2 adjectives at most (e.g., "crown chrome", "heart glass red").
  - No sentences, no commas, no semicolons, no extra descriptors, no scene words.
  - One main object only. No people, brands, or logos.`;

  const user = `Song context JSON (for reference):\n${JSON.stringify(
    fullContext,
    null,
    2
  )}\n\n${guidelines}\n\nTask: Return ONE SINGLE line Meshy prompt for a 3D object that represents this song.`;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const normalizeModel = (raw: string | undefined): string => {
      const v = (raw ?? "gpt-5").trim().toLowerCase();
      if (v === "gpt5" || v === "gpt 5") return "gpt-5";
      return v;
    };
    const model = normalizeModel(process.env.OPENAI_MODEL);
    
    console.log(`[MESHY] Generating prompt for track: ${fullContext.core.title} by ${fullContext.core.artist}`);
    console.log(`[MESHY] Using model: ${model}`);
    
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "text" } as any,
    });
    
    let prompt = (completion.choices[0]?.message?.content || "").trim();
    // Ensure the primary artist name is present first and condense words after the dash
    const firstArtist = (fullContext.core.artist || "").split(",")[0]?.trim();
    if (firstArtist) {
      const escaped = firstArtist.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      const startsWithArtist = new RegExp(`^\n?\s*${escaped}\\b`, "i").test(prompt);
      if (!startsWithArtist) {
        const trailingArtist = new RegExp(`\n?\s*—\s*${escaped}\s*$`, "i");
        prompt = prompt.replace(trailingArtist, "").trim();
        prompt = `${firstArtist} — ${prompt}`.trim();
      }

      // Condense the phrase after the dash to 2-4 tokens without punctuation
      const parts = prompt.split(/—|--|\u2014/);
      let after = parts.length > 1 ? parts.slice(1).join(" ") : prompt;
      after = after.replace(/[.,;:!?"'()\[\]{}]/g, " ")
                   .replace(/\s+/g, " ")
                   .trim();
      const maxWords = Math.max(2, Math.min(4, parseInt(process.env.MESHY_PROMPT_WORDS || "3", 10)));
      const words = after.split(" ").filter(Boolean).slice(0, maxWords);
      if (words.length > 0) {
        prompt = `${firstArtist} — ${words.join(" ")}`.trim();
      } else {
        prompt = `${firstArtist} — iconic object`;
      }
    }
    
    console.log(`[MESHY] OpenAI response for "${fullContext.core.title}":`);
    console.log(`[MESHY] Generated prompt: "${prompt}"`);
    console.log(`[MESHY] Prompt length: ${prompt.length} characters`);
    
    return NextResponse.json({ prompt });
  } catch (e: unknown) {
    const prompt = `abstract music note, glossy midnight blue plastic, minimal — single object, no scene, neutral lighting`;
    return NextResponse.json({
      prompt,
      fallback: `openai_error:${(e as Error)?.message ?? "unknown"}`,
    });
  }
}

