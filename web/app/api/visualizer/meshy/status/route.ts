import { NextResponse } from "next/server";
import { cacheGetOrSet, cacheSet } from "@/lib/cache";

// GET /api/visualizer/meshy/status?id=...
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const apiKey = process.env.MESHY_API_KEY;
  
  console.log(`[MESHY STATUS] Checking status for generation ID: ${id}`);
  
  if (!apiKey) {
    console.log(`[MESHY STATUS] Error: Missing MESHY_API_KEY environment variable`);
    return NextResponse.json(
      { error: "Missing MESHY_API_KEY" },
      { status: 500 }
    );
  }

  try {
    const primaryUrl = `https://api.meshy.ai/v2/text-to-3d/${encodeURIComponent(id)}`;
    console.log(`[MESHY STATUS] Calling Meshy status API for ID: ${id} at ${primaryUrl}`);

    const cacheKey = `meshy:status:${id}`;
    const ttlMs = parseInt(process.env.MESHY_STATUS_CACHE_TTL_MS || "15000", 10); // 15s

    const { status, json } = await cacheGetOrSet<{ status: number; json: any }>(
      cacheKey,
      ttlMs,
      async () => {
        let res = await fetch(primaryUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          cache: "no-store",
        });

        // If Meshy returns routing error, try legacy path as a fallback
        let json = await res.json().catch(() => ({} as any));
        if (
          res.status === 404 &&
          typeof json?.message === "string" &&
          /NoMatchingRoute/i.test(json.message)
        ) {
          const fallbackUrl = `https://api.meshy.ai/v2/generations/${encodeURIComponent(id)}`;
          console.log(
            `[MESHY STATUS] Primary status path not found, trying fallback: ${fallbackUrl}`
          );
          res = await fetch(fallbackUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
            cache: "no-store",
          });
          json = await res.json().catch(() => ({} as any));
        }
        return { status: res.status, json };
      }
    );

    console.log(
      `[MESHY STATUS] Status API response for ${id}:`,
      JSON.stringify(json, null, 2)
    );

    if (status < 200 || status >= 300) return NextResponse.json(json, { status });
    // Persist modelUrl if present so future runs can short-circuit
    try {
      const tryModelUrls = (obj: any): string | null => {
        if (!obj || typeof obj !== "object") return null;
        const glb = (obj as any).glb ?? (obj as any).GLB;
        const gltf = (obj as any).gltf ?? (obj as any).GLTF;
        if (typeof glb === "string") return glb;
        if (typeof gltf === "string") return gltf;
        return null;
      };
      let modelUrl: string | null = null;
      modelUrl = (json && (json.model_url || json.modelUrl)) || null;
      if (!modelUrl) modelUrl = tryModelUrls(json?.model_urls) || tryModelUrls(json?.modelUrls);
      if (!modelUrl && Array.isArray(json?.assets)) {
        for (const a of json.assets as any[]) {
          const url = typeof a?.url === "string" ? a.url : null;
          const fmt = (a?.format ?? a?.type ?? a?.mimeType ?? "").toString().toLowerCase();
          if (url && (url.endsWith(".glb") || url.endsWith(".gltf") || fmt.includes("glb") || fmt.includes("gltf"))) {
            modelUrl = url; break;
          }
        }
      }
      const sid = json?.task_id || json?.id || id;
      const trackId = json?.metadata?.spotifyId || json?.spotifyId; // best-effort if backend echoes it
      if (typeof modelUrl === "string" && modelUrl && typeof trackId === "string") {
        cacheSet(`meshy:modelUrl:${trackId}`, modelUrl, parseInt(process.env.MESHY_MODEL_URL_TTL_MS || "604800000", 10)); // 7d
      }
    } catch {}
    return NextResponse.json(json);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Unknown" },
      { status: 500 }
    );
  }
}
