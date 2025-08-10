import { NextResponse } from "next/server";

// Proxies a Meshy asset URL (e.g., GLB) to avoid CORS issues in the browser
// GET /api/visualizer/meshy/fetch?url=<encoded-meshy-asset-url>
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let remote: URL;
  try {
    remote = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  const allowedHosts = new Set(["assets.meshy.ai", "cdn.meshy.ai"]);
  if (!allowedHosts.has(remote.hostname)) {
    return NextResponse.json({ error: "Forbidden host" }, { status: 403 });
  }

  try {
    const res = await fetch(remote.toString(), { cache: "no-store" });
    const contentType = res.headers.get("content-type") || "application/octet-stream";

    // Stream body through with minimal header normalization
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Unknown" },
      { status: 500 }
    );
  }
}


