import { NextResponse } from "next/server";
import finder from "spotify-preview-finder";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title");
  const artist = searchParams.get("artist");
  const limit = Number(searchParams.get("limit") || 3);

  if (!title) {
    return NextResponse.json({ error: "Missing title" }, { status: 400 });
  }

  try {
    let result;
    if (artist) {
      result = await (finder as any)(title, artist, Math.max(1, Math.min(5, limit)));
    } else {
      result = await (finder as any)(title, Math.max(1, Math.min(5, limit)));
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message ?? "Unknown error" }, { status: 500 });
  }
}


