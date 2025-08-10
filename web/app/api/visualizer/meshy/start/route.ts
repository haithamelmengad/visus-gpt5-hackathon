import { NextResponse } from "next/server";
import { z } from "zod";
import { cacheGet, cacheGetOrSet, cacheSet } from "@/lib/cache";

const inputSchema = z.object({
  prompt: z.string().min(8),
  mode: z.enum(["preview", "refine"]).optional().default("preview"),
  previewId: z.string().optional(), // Required when mode is "refine"
  spotifyId: z.string().optional(), // Stable key for caching
});

/**
 * Meshy 3D Generation Workflow:
 *
 * 1. PREVIEW MODE (default):
 *    - POST /api/visualizer/meshy/start with { prompt, mode: "preview" }
 *    - Returns { id, mode: "preview" }
 *    - Use this ID to poll /api/visualizer/meshy/status?id=<id>
 *    - When status shows "completed", you get a low-quality preview model
 *
 * 2. REFINE MODE:
 *    - POST /api/visualizer/meshy/start with { prompt, mode: "refine", previewId: "<preview-id>" }
 *    - OR use the dedicated refine endpoint: POST /api/visualizer/meshy/refine with { previewId, prompt?, enablePbr?, topology? }
 *    - Returns { id, mode: "refine", previewId }
 *    - Use this ID to poll /api/visualizer/meshy/status?id=<id>
 *    - When status shows "completed", you get the final high-quality model
 *
 * 3. FETCH MODEL:
 *    - Use /api/visualizer/meshy/fetch?url=<model-url> to proxy the final GLB/GLTF file
 *
 * Note: Refine mode requires a completed preview generation ID and produces higher quality results.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { prompt, mode, previewId, spotifyId } = parsed.data;

  // Validate that previewId is provided when mode is "refine"
  if (mode === "refine" && !previewId) {
    return NextResponse.json(
      {
        error: "previewId is required when mode is 'refine'",
      },
      { status: 400 }
    );
  }
  const apiKey = process.env.MESHY_API_KEY;

  console.log(
    `[MESHY START] Starting ${mode} mode 3D generation with prompt: "${prompt}"`
  );
  console.log(`[MESHY START] Mode: ${mode}`);
  if (mode === "refine") {
    console.log(`[MESHY START] Refining preview ID: ${previewId}`);
  }
  console.log(`[MESHY START] Prompt length: ${prompt.length} characters`);

  if (!apiKey) {
    console.log(
      `[MESHY START] Error: Missing MESHY_API_KEY environment variable`
    );
    return NextResponse.json(
      { error: "Missing MESHY_API_KEY" },
      { status: 500 }
    );
  }

  try {
    console.log(
      `[MESHY START] Calling Meshy API with key: ${apiKey.substring(0, 8)}...`
    );

    const cacheKey = `meshy:start:${mode}:${prompt}${
      mode === "refine" ? `:${previewId}` : ""
    }`;
    const ttlMs = parseInt(
      process.env.MESHY_START_CACHE_TTL_MS || "300000",
      10
    ); // 5 min default

    // Parameters for Meshy API based on mode
    const enhancedParams = {
      mode,
      prompt,
      topology: "triangle",
      enable_pbr: true,
      ...(mode === "refine" && previewId ? { PreviewTaskID: previewId } : {}),
      ...(mode === "preview"
        ? { seed: Math.floor(Math.random() * 1000000) }
        : {}), // Random seed only for preview mode
    };

    console.log(
      `[MESHY START] Enhanced API parameters:`,
      JSON.stringify(enhancedParams, null, 2)
    );

    // Fast path: if we already have a generation ID for these inputs, return it immediately
    if (mode === "refine" && previewId) {
      const existingRefineId = cacheGet<string>(
        `meshy:refinement:${previewId}`
      );
      if (existingRefineId && typeof existingRefineId === "string") {
        return NextResponse.json({
          id: existingRefineId,
          mode: "refine",
          previewId,
        });
      }
    }
    if (mode === "preview") {
      // Prefer stable lookup by spotifyId if provided
      if (spotifyId) {
        const byTrack = cacheGet<string>(`meshy:previewByTrack:${spotifyId}`);
        if (byTrack && typeof byTrack === "string") {
          return NextResponse.json({ id: byTrack, mode: "preview" });
        }
      }
      // Fallback to prompt mapping
      const byPrompt = cacheGet<string>(`meshy:previewByPrompt:${prompt}`);
      if (byPrompt && typeof byPrompt === "string") {
        return NextResponse.json({ id: byPrompt, mode: "preview" });
      }
    }

    const { status, json } = await cacheGetOrSet<{
      status: number;
      json: Record<string, unknown>;
    }>(cacheKey, ttlMs, async () => {
      const res = await fetch("https://api.meshy.ai/v2/text-to-3d", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(enhancedParams),
      });
      const json = await res.json();
      return { status: res.status, json };
    });

    console.log(`[MESHY START] Meshy API response status: ${status}`);
    console.log(
      `[MESHY START] Meshy API response:`,
      JSON.stringify(json, null, 2)
    );

    if (status < 200 || status >= 300)
      return NextResponse.json(json, { status });

    // Normalize Meshy response to always return { id } for client polling
    // Meshy may return various shapes; try common possibilities.
    const jsonObj = json as Record<string, unknown>;
    let idCandidate =
      (jsonObj && (jsonObj.id || jsonObj.task_id || jsonObj.generation_id)) ||
      (jsonObj?.result &&
        typeof jsonObj.result === "object" &&
        jsonObj.result &&
        ((jsonObj.result as Record<string, unknown>).id ||
          (jsonObj.result as Record<string, unknown>).task_id)) ||
      (jsonObj?.data &&
        typeof jsonObj.data === "object" &&
        jsonObj.data &&
        ((jsonObj.data as Record<string, unknown>).id ||
          (jsonObj.data as Record<string, unknown>).task_id));

    // Meshy sometimes returns { result: "<generation-id>" }
    if (!idCandidate && typeof jsonObj?.result === "string") {
      idCandidate = jsonObj.result;
    }

    if (typeof idCandidate === "string" && idCandidate.trim().length > 0) {
      console.log(`[MESHY START] Normalized generation ID: ${idCandidate}`);

      // Cache the generation ID for future reference
      if (mode === "preview") {
        cacheSet(
          `meshy:preview:${idCandidate}`,
          { prompt, timestamp: Date.now() },
          parseInt(process.env.MESHY_PREVIEW_CACHE_TTL_MS || "86400000", 10) // 24h default
        );
        // Also map prompt -> preview id for fast lookup across sessions
        cacheSet(
          `meshy:previewByPrompt:${prompt}`,
          idCandidate,
          parseInt(process.env.MESHY_PREVIEW_CACHE_TTL_MS || "86400000", 10)
        );
        // If a track ID was provided, bind it to this preview id for stability
        if (spotifyId) {
          cacheSet(
            `meshy:previewByTrack:${spotifyId}`,
            idCandidate,
            parseInt(process.env.MESHY_PREVIEW_CACHE_TTL_MS || "86400000", 10)
          );
        }
      }

      // Map generation id back to spotifyId when available so status can persist model URL by track
      if (spotifyId && typeof idCandidate === "string") {
        cacheSet(
          `meshy:genToTrack:${idCandidate}`,
          spotifyId,
          parseInt(process.env.MESHY_ID_TO_TRACK_TTL_MS || "172800000", 10) // 48h
        );
      }

      return NextResponse.json({
        id: idCandidate,
        mode,
        ...(mode === "refine" && previewId ? { previewId } : {}),
      });
    }

    // If we cannot find an id, return a 502 with the raw for debugging
    console.log(`[MESHY START] Could not find generation id in response.`);
    return NextResponse.json(
      { error: "missing_id", raw: json },
      { status: 502 }
    );
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Unknown" },
      { status: 500 }
    );
  }
}
