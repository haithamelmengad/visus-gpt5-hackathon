import { NextResponse } from "next/server";
import { z } from "zod";
import { cacheGetOrSet, cacheSet } from "@/lib/cache";

const inputSchema = z.object({
  previewId: z.string().min(1),
  prompt: z.string().optional(), // Optional override prompt for refinement
  enablePbr: z.boolean().optional().default(true),
  topology: z.enum(["triangle", "quad"]).optional().default("triangle"),
});

// Refines a preview generation to get the final high-quality 3D model
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { previewId, prompt, enablePbr, topology } = parsed.data;
  const apiKey = process.env.MESHY_API_KEY;

  console.log(
    `[MESHY REFINE] Starting refinement for preview ID: ${previewId}`
  );
  console.log(`[MESHY REFINE] Override prompt: ${prompt || "using original"}`);
  console.log(`[MESHY REFINE] PBR enabled: ${enablePbr}`);
  console.log(`[MESHY REFINE] Topology: ${topology}`);

  if (!apiKey) {
    console.log(
      `[MESHY REFINE] Error: Missing MESHY_API_KEY environment variable`
    );
    return NextResponse.json(
      { error: "Missing MESHY_API_KEY" },
      { status: 500 }
    );
  }

  try {
    console.log(
      `[MESHY REFINE] Calling Meshy refine API with key: ${apiKey.substring(
        0,
        8
      )}...`
    );

    const cacheKey = `meshy:refine:${previewId}`;
    const ttlMs = parseInt(
      process.env.MESHY_REFINE_CACHE_TTL_MS || "600000",
      10
    ); // 10 min default

    // Refine mode parameters for Meshy API
    const refineParams = {
      mode: "refine",
      prompt: prompt || undefined, // Only include if provided
      topology,
      enable_pbr: enablePbr,
      // Include the preview ID to reference the original generation
      // Meshy API expects preview_task_id (snake_case)
      preview_task_id: previewId,
      // Additional required fields for refine mode
      art_style: "realistic", // Default art style
      texture_richness: "high", // Default texture quality
    };

    // Remove undefined values to avoid API issues
    Object.keys(refineParams).forEach((key) => {
      if (refineParams[key as keyof typeof refineParams] === undefined) {
        delete refineParams[key as keyof typeof refineParams];
      }
    });

    console.log(
      `[MESHY REFINE] Refine API parameters:`,
      JSON.stringify(refineParams, null, 2)
    );

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
        body: JSON.stringify(refineParams),
      });
      const json = await res.json();
      return { status: res.status, json };
    });

    console.log(`[MESHY REFINE] Meshy API response status: ${status}`);
    console.log(
      `[MESHY REFINE] Meshy API response:`,
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
      console.log(`[MESHY REFINE] Normalized refinement ID: ${idCandidate}`);

      // Cache the refinement ID for future reference
      cacheSet(
        `meshy:refinement:${previewId}`,
        idCandidate,
        parseInt(process.env.MESHY_REFINEMENT_CACHE_TTL_MS || "86400000", 10) // 24h default
      );

      return NextResponse.json({
        id: idCandidate,
        previewId,
        mode: "refine",
      });
    }

    // If we cannot find an id, return a 502 with the raw for debugging
    console.log(`[MESHY REFINE] Could not find refinement id in response.`);
    return NextResponse.json(
      { error: "missing_id", raw: json },
      { status: 502 }
    );
  } catch (e: unknown) {
    console.error(`[MESHY REFINE] Error during refinement:`, e);
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Unknown" },
      { status: 500 }
    );
  }
}
