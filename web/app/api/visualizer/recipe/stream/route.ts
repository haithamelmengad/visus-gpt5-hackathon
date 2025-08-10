import { NextResponse } from "next/server";
import OpenAI from "openai";

type VisualizerRecipe = {
  seed?: string;
  concept: string;
  rationale: string;
  baseGeometry: "sphere" | "box" | "plane" | "torus" | "cylinder" | "custom";
  customKind?:
    | "sunglasses"
    | "lightbulb"
    | "heart"
    | "star"
    | "bolt"
    | "vinyl"
    | "music_note";
  baseParams: Record<string, number>;
  colorPalette: string[];
  textureIdea?: string;
  deformation:
    | { type: "noise"; amplitude: number; frequency: number }
    | { type: "spike"; spikes: number; amplitude: number }
    | {
        type: "wave";
        axis: "x" | "y" | "z";
        amplitude: number;
        frequency: number;
      };
  audioMapping: {
    fftBands: { low: number; mid: number; high: number };
    spotifyWeights: Partial<{
      energy: number;
      valence: number;
      danceability: number;
      tempo: number;
      loudness: number;
      acousticness: number;
      instrumentalness: number;
      liveness: number;
      speechiness: number;
    }>;
  };
  fallbackPrompt?: string;
};

function sseEvent(event: string, data: unknown): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const spotifyId = searchParams.get("spotifyId") || "";
    const title = searchParams.get("title") || "";
    const artist = searchParams.get("artist") || "";
    const includeAnalysis = searchParams.get("includeAnalysis") === "1";

    // If no API key, stream a deterministic fallback, including its rationale
    if (!process.env.OPENAI_API_KEY) {
      const fallback: VisualizerRecipe = {
        seed: `${(title || "Track").replace(/[^a-zA-Z0-9\s]/g, "")} ${
          (artist || "").split(",")[0] || ""
        }`.trim(),
        concept: `${title || "Track"} – iconic minimal form`,
        rationale:
          "Fallback: simple sphere with audio-reactive noise deformation; bright palette for legibility.",
        baseGeometry: "sphere",
        baseParams: { radius: 1.1, widthSegments: 192, heightSegments: 192 },
        colorPalette: ["#9C27B0", "#03A9F4", "#FFFFFF"],
        deformation: { type: "noise", amplitude: 0.35, frequency: 2.2 },
        audioMapping: {
          fftBands: { low: 2, mid: 24, high: 96 },
          spotifyWeights: { energy: 0.6, danceability: 0.25, valence: 0.15 },
        },
      };

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(sseEvent("reason", fallback.rationale))
          );
          controller.enqueue(encoder.encode(sseEvent("result", fallback)));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const system = `You are a concise visual art director. You output a single JSON object following the schema provided by the user, with no extra prose. While composing, your JSON must contain a succinct 'rationale' string that explains the visual choice. Do not include extra keys beyond the schema.`;
    const schemaHint = `Schema to follow (TypeScript):\n type VisualizerRecipe = { seed?: string; concept: string; rationale: string; baseGeometry: "sphere"|"box"|"plane"|"torus"|"cylinder"|"custom"; customKind?: "sunglasses"|"lightbulb"|"heart"|"star"|"bolt"|"vinyl"|"music_note"; baseParams: Record<string, number>; colorPalette: string[]; textureIdea?: string; deformation: { type: "noise"; amplitude: number; frequency: number } | { type: "spike"; spikes: number; amplitude: number } | { type: "wave"; axis: "x"|"y"|"z"; amplitude: number; frequency: number }; audioMapping: { fftBands: { low: number; mid: number; high: number }; spotifyWeights: Partial<{ energy: number; valence: number; danceability: number; tempo: number; loudness: number; acousticness: number; instrumentalness: number; liveness: number; speechiness: number; }>; }; }`;

    const user = `Title: ${title}\nArtist: ${artist}\nSpotifyId: ${spotifyId}\n\n${schemaHint}\n\nTask: Stream a JSON recipe for a 3D visualizer. Keep it minimal but expressive. Ensure 'rationale' succinctly explains the choice. Start with opening brace quickly and build fields in a typical top-to-bottom order so the 'rationale' string appears early.`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          // Stream tokens
          const completion = await openai.chat.completions.create({
            model: (
              process.env.OPENAI_FAST_MODEL ||
              process.env.OPENAI_MODEL ||
              "gpt-5"
            ).toString(),
            stream: true,
            temperature: 0.4,
            max_tokens: 450,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          });

          let full = "";
          // Naive incremental parser to extract rationale string content
          let inRationale = false;
          let rationaleOpenIndex = -1;
          let escapeNext = false;

          for await (const part of completion) {
            const delta = part.choices?.[0]?.delta?.content ?? "";
            if (!delta) continue;
            full += delta;

            // Incremental scan for '"rationale"' field content
            for (let i = 0; i < delta.length; i++) {
              const ch = delta[i];
              // Detect start of rationale string
              if (!inRationale && rationaleOpenIndex === -1) {
                const window = (
                  full.slice(-64) + delta.slice(0, i + 1)
                ).toLowerCase();
                if (window.includes('"rationale"')) {
                  // Find the first double quote after the colon
                  const after = full.toLowerCase().lastIndexOf('"rationale"');
                  // set open index when we see the next '"'
                  // leave detection to the stream below
                }
              }

              // Once we've seen the key, toggle when entering the string body
              if (!inRationale && rationaleOpenIndex === -1 && ch === '"') {
                // Heuristic: previous non-space character should be ':' indicating start of string
                const prev = (full + delta.slice(0, i))
                  .replace(/\s+/g, "")
                  .slice(-2);
                if (prev.endsWith(":")) {
                  inRationale = true;
                  rationaleOpenIndex = full.length + i;
                  continue;
                }
              }

              if (inRationale) {
                if (escapeNext) {
                  escapeNext = false;
                } else if (ch === "\\") {
                  escapeNext = true;
                } else if (ch === '"') {
                  // Close rationale
                  inRationale = false;
                  rationaleOpenIndex = -1;
                } else {
                  // Stream the character
                  controller.enqueue(encoder.encode(sseEvent("reason", ch)));
                }
              }
            }
          }

          // Try to parse final JSON object
          let recipe: VisualizerRecipe | null = null;
          try {
            recipe = JSON.parse(full) as VisualizerRecipe;
          } catch {
            // If parsing fails, provide a minimal fallback
            recipe = {
              seed: `${title}`.replace(/[^a-zA-Z0-9\s]/g, ""),
              concept: `${title || "Track"}`,
              rationale: "Generated minimal fallback due to JSON parse error.",
              baseGeometry: "sphere",
              baseParams: {
                radius: 1,
                widthSegments: 128,
                heightSegments: 128,
              },
              colorPalette: ["#ffffff", "#222222", "#ff4081"],
              deformation: { type: "noise", amplitude: 0.3, frequency: 2.5 },
              audioMapping: {
                fftBands: { low: 2, mid: 32, high: 128 },
                spotifyWeights: {
                  energy: 0.6,
                  valence: 0.2,
                  danceability: 0.2,
                },
              },
              fallbackPrompt: "openai_json_parse_error",
            } as VisualizerRecipe;
          }

          controller.enqueue(encoder.encode(sseEvent("result", recipe)));
          controller.close();
        } catch (err) {
          const message = (err as Error)?.message || "unknown";
          controller.enqueue(encoder.encode(sseEvent("error", message)));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "unknown" },
      { status: 500 }
    );
  }
}
