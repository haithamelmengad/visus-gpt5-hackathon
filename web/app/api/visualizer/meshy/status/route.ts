import { NextResponse } from "next/server";

// GET /api/visualizer/meshy/status?id=...
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey)
    return NextResponse.json(
      { error: "Missing MESHY_API_KEY" },
      { status: 500 }
    );

  try {
    const res = await fetch(
      `https://api.meshy.ai/v2/generations/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      }
    );
    const json = await res.json();
    if (!res.ok) return NextResponse.json(json, { status: res.status });
    return NextResponse.json(json);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Unknown" },
      { status: 500 }
    );
  }
}
