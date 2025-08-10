import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

type SpotifyTrack = {
  id: string;
  name: string;
  artists?: { id?: string; name: string }[];
  album?: { images?: { url?: string }[] };
  external_urls?: { spotify?: string };
  preview_url?: string | null;
};

type RecentlyPlayedResponse = {
  items?: { track: SpotifyTrack; played_at: string }[];
};

type EnrichedItem = {
  id: string;
  title: string;
  artistNames: string;
  albumImageUrl?: string;
  spotifyUrl?: string;
  previewUrl: string | null;
  features: Record<string, unknown> | null;
  played_at: string;
};

function extractFirstPreviewUrl(data: unknown): string | null {
  type PreviewResult = {
    previewUrls?: string[];
    previewUrl?: string;
    preview_url?: string;
    previews?: string[];
    [key: string]: unknown;
  };
  type ApiResponse =
    | { results?: PreviewResult[] }
    | PreviewResult[]
    | null
    | undefined;
  const d = data as ApiResponse;
  const results: PreviewResult[] = Array.isArray(d)
    ? (d as PreviewResult[])
    : Array.isArray(d?.results)
    ? (d!.results as PreviewResult[])
    : [];
  const first: PreviewResult = results[0] ?? {};
  const urls: string[] = [];
  if (Array.isArray(first?.previewUrls)) urls.push(...first.previewUrls);
  if (typeof first?.previewUrl === "string") urls.push(first.previewUrl);
  if (typeof first?.preview_url === "string") urls.push(first.preview_url);
  if (Array.isArray(first?.previews)) urls.push(...first.previews);
  return urls[0] ?? null;
}

async function resolvePreviewUrl(
  origin: string,
  title: string,
  artistNames: string
): Promise<string | null> {
  const tryFetch = async (qs: string): Promise<string | null> => {
    try {
      const r = await fetch(`${origin}/api/preview?${qs}`, {
        cache: "no-store",
      });
      if (!r.ok) return null;
      const data = await r.json();
      return extractFirstPreviewUrl(data);
    } catch {
      return null;
    }
  };

  // 1) Try title + all artists
  let url = await tryFetch(
    `title=${encodeURIComponent(title)}&artist=${encodeURIComponent(
      artistNames
    )}&limit=1`
  );
  if (url) return url;
  // 2) Try title + first artist
  const firstArtist = artistNames.split(",")[0]?.trim() ?? "";
  if (firstArtist) {
    url = await tryFetch(
      `title=${encodeURIComponent(title)}&artist=${encodeURIComponent(
        firstArtist
      )}&limit=1`
    );
    if (url) return url;
  }
  // 3) Try title only
  url = await tryFetch(`title=${encodeURIComponent(title)}&limit=1`);
  if (url) return url;
  return null;
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !(session as any).accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    let limit = 10; // enforce at most 10 to avoid rate limiting
    if (limitParam) {
      const parsed = Number(limitParam);
      if (!Number.isNaN(parsed)) {
        limit = Math.min(10, Math.max(1, parsed));
      }
    }

    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    const recentUrl = `https://api.spotify.com/v1/me/player/recently-played?${qs.toString()}`;

    const recentRes = await fetch(recentUrl, {
      headers: { Authorization: `Bearer ${(session as any).accessToken}` },
      cache: "no-store",
    });
    if (!recentRes.ok) {
      const txt = await recentRes.text();
      return NextResponse.json(
        { error: "Spotify recently played error", details: txt },
        { status: recentRes.status }
      );
    }
    const recent = (await recentRes.json()) as RecentlyPlayedResponse;
    const items = Array.isArray(recent?.items)
      ? recent.items!.slice(0, limit)
      : [];

    // Build ordered unique track list for batching features/preview
    const orderedUniqueIds: string[] = [];
    const idToTrack = new Map<string, SpotifyTrack>();
    for (const it of items) {
      const t = it.track;
      if (t && typeof t?.id === "string" && !idToTrack.has(t.id)) {
        idToTrack.set(t.id, t);
        orderedUniqueIds.push(t.id);
      }
    }

    // Batch fetch audio features
    const featuresMap = new Map<string, Record<string, unknown> | null>();
    if (orderedUniqueIds.length > 0) {
      const idsParam = orderedUniqueIds.join(",");
      const featRes = await fetch(
        `https://api.spotify.com/v1/audio-features?ids=${encodeURIComponent(
          idsParam
        )}`,
        {
          headers: { Authorization: `Bearer ${(session as any).accessToken}` },
          cache: "no-store",
        }
      );
      if (featRes.ok) {
        const featJson = (await featRes.json()) as { audio_features?: any[] };
        const arr = Array.isArray(featJson?.audio_features)
          ? featJson.audio_features!
          : [];
        for (const f of arr) {
          const fid = (f?.id ?? "") as string;
          if (fid) featuresMap.set(fid, f as Record<string, unknown>);
        }
      }
    }

    // Resolve preview URLs (prefer Spotify's own when present)
    const origin = new URL(request.url).origin;
    const previewMap = new Map<string, string | null>();
    await Promise.all(
      orderedUniqueIds.map(async (id) => {
        const t = idToTrack.get(id)!;
        const direct =
          typeof t.preview_url === "string" ? (t.preview_url as string) : null;
        if (direct) {
          previewMap.set(id, direct);
          return;
        }
        const title = t.name ?? "";
        const artistNames = (t.artists ?? [])
          .map((a) => a?.name)
          .filter(Boolean)
          .join(", ");
        const resolved = await resolvePreviewUrl(origin, title, artistNames);
        previewMap.set(id, resolved);
      })
    );

    // Shape response items
    const enriched: EnrichedItem[] = items.map((it) => {
      const t = it.track;
      const id = t.id;
      const title = t.name ?? "";
      const artistNames = (t.artists ?? [])
        .map((a) => a?.name)
        .filter(Boolean)
        .join(", ");
      const albumImageUrl = t.album?.images?.[0]?.url;
      const spotifyUrl = t.external_urls?.spotify;
      const previewUrl = previewMap.get(id) ?? null;
      const features = featuresMap.get(id) ?? null;
      return {
        id,
        title,
        artistNames,
        albumImageUrl,
        spotifyUrl,
        previewUrl,
        features,
        played_at: it.played_at,
      };
    });

    return NextResponse.json({ items: enriched });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
