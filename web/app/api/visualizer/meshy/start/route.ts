import { NextResponse } from "next/server";
import { z } from "zod";
import { cacheGetOrSet, cacheSet } from "@/lib/cache";

const inputSchema = z.object({ prompt: z.string().min(8) });

// Starts a Meshy text-to-3D generation and returns an id for polling
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { prompt } = parsed.data;
  const apiKey = process.env.MESHY_API_KEY;
  
  console.log(`[MESHY START] Starting 3D generation with prompt: "${prompt}"`);
  console.log(`[MESHY START] Prompt length: ${prompt.length} characters`);
  
  if (!apiKey) {
    console.log(`[MESHY START] Error: Missing MESHY_API_KEY environment variable`);
    return NextResponse.json(
      { error: "Missing MESHY_API_KEY" },
      { status: 500 }
    );
  }

  try {
    console.log(`[MESHY START] Calling Meshy API with key: ${apiKey.substring(0, 8)}...`);

    const cacheKey = `meshy:start:${prompt}`;
    const ttlMs = parseInt(process.env.MESHY_START_CACHE_TTL_MS || "300000", 10); // 5 min default
    const { status, json } = await cacheGetOrSet<{ status: number; json: any }>(
      cacheKey,
      ttlMs,
      async () => {
        const res = await fetch("https://api.meshy.ai/v2/text-to-3d", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mode: "preview",
            prompt,
            topology: "triangle",
            enable_pbr: true,
          }),
        });
        const json = await res.json();
        return { status: res.status, json };
      }
    );

    console.log(`[MESHY START] Meshy API response status: ${status}`);
    console.log(`[MESHY START] Meshy API response:`, JSON.stringify(json, null, 2));

    if (status < 200 || status >= 300) return NextResponse.json(json, { status });

    // Normalize Meshy response to always return { id } for client polling
    // Meshy may return various shapes; try common possibilities.
    let idCandidate =
      (json && (json.id || json.task_id || json.generation_id)) ||
      (json?.result && (json.result.id || json.result.task_id)) ||
      (json?.data && (json.data.id || json.data.task_id));

    // Meshy sometimes returns { result: "<generation-id>" }
    if (!idCandidate && typeof json?.result === "string") {
      idCandidate = json.result;
    }

    if (typeof idCandidate === "string" && idCandidate.trim().length > 0) {
      console.log(`[MESHY START] Normalized generation ID: ${idCandidate}`);
      return NextResponse.json({ id: idCandidate });
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
