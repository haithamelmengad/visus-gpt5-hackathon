import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function GET(_request: Request, { params }: any) {
  const session = await getServerSession(authOptions);
  const accessToken = (session as unknown as { accessToken?: string })?.accessToken;
  if (!session || !accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = (await params).id;
  if (!id) {
    return NextResponse.json({ error: "Missing track id" }, { status: 400 });
  }

  try {
    const url = `https://api.spotify.com/v1/audio-features/${encodeURIComponent(id)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      return NextResponse.json(
        { error: "Spotify API error", details: body },
        { status: response.status }
      );
    }
    const data = (await response.json()) as unknown;
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


