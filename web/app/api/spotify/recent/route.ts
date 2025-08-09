import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !(session as any).accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const after = searchParams.get("after");
    const before = searchParams.get("before");

    let limit = 50;
    if (limitParam) {
      const parsed = Number(limitParam);
      if (!Number.isNaN(parsed)) {
        limit = Math.min(50, Math.max(1, parsed));
      }
    }

    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    if (after) qs.set("after", after);
    if (before) qs.set("before", before);

    const url = `https://api.spotify.com/v1/me/player/recently-played?${qs.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${(session as any).accessToken}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return NextResponse.json(
        { error: "Spotify API error", details: errorBody },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Unknown error" }, { status: 500 });
  }
}


