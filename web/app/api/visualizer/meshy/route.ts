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

  const system = `You are a senior 3D artist expert at prompting Meshy (text-to-3D). Output ONLY a single-line prompt optimized for Meshy to generate one iconic object that visually represents the song. No extra words.`;

  const guidelines = `Prompt rules:
- One main object only (no environment, no floor, no background, no camera text).
- Use concrete nouns (e.g., sunglasses, light bulb, vinyl record, heart, lightning bolt, music note, microphone) and specify distinctive style/material only if useful.
- Include 2-4 vivid adjectives tied to the song mood and palette.
- Mention material finish (e.g., glossy plastic, chrome metal, tinted glass), approximate color(s), and silhouette cues.
- Avoid text, logos, brand names, people, and scenes. Keep neutral pose/orientation.
- Keep it under 220 characters.`;

  const user = `Song context JSON (for reference):\n${JSON.stringify(
    fullContext,
    null,
    2
  )}\n\n${guidelines}\n\nTask: Return ONE SINGLE line Meshy prompt for a 3D object that represents this song.`;

  if (!process.env.OPENAI_API_KEY) {
    // Deterministic fallback prompt using title and a heuristic
    const t = fullContext.core.title.toLowerCase();
    const a = fullContext.core.artist.toLowerCase();
    const pick = () => {
      if (/blinding|light/i.test(t))
        return "sleek sunglasses, tinted violet glass, glossy black frame, neon reflections";
      if (/heart|love/i.test(t))
        return "stylized heart, glossy candy red plastic, soft bevels";
      if (/electric|lightning|thunder/i.test(t))
        return "lightning bolt, smooth chrome metal, sharp silhouette";
      if (/vinyl|retro|disco/i.test(t))
        return "vinyl record, matte black with subtle grooves, small center label";
      return "abstract music note, glossy midnight blue plastic, minimal";
    };
    const prompt = `${pick()} — single object, no scene, neutral lighting`;
    return NextResponse.json({ prompt });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const normalizeModel = (raw: string | undefined): string => {
      const v = (raw ?? "gpt-5").trim().toLowerCase();
      if (v === "gpt5" || v === "gpt 5") return "gpt-5";
      return v;
    };
    const model = normalizeModel(process.env.OPENAI_MODEL);
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "text" } as any,
    });
    const prompt = (completion.choices[0]?.message?.content || "").trim();
    return NextResponse.json({ prompt });
  } catch (e: unknown) {
    const prompt = `abstract music note, glossy midnight blue plastic, minimal — single object, no scene, neutral lighting`;
    return NextResponse.json({
      prompt,
      fallback: `openai_error:${(e as Error)?.message ?? "unknown"}`,
    });
  }
}
