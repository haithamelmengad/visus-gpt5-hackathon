import { NextResponse } from "next/server";

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

    console.log(
      `[MESHY STATUS] Status API response for ${id}:`,
      JSON.stringify(json, null, 2)
    );

    if (!res.ok) return NextResponse.json(json, { status: res.status });
    return NextResponse.json(json);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Unknown" },
      { status: 500 }
    );
  }
}
