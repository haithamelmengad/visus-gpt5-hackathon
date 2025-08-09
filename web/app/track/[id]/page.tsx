import Link from "next/link";
import TrackVisualClient from "@/components/TrackVisualClient";
import { headers as nextHeaders } from "next/headers";

async function getTrack(id: string, accessToken: string) {
  const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    // avoid caching since token and data can change
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch track: ${res.status}`);
  }
  return res.json();
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function TrackPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  if (
    !session ||
    !(session as unknown as { accessToken?: string }).accessToken
  ) {
    return (
      <div style={{ padding: 24 }}>
        <p>You must be signed in.</p>
        <Link href="/">Go home</Link>
      </div>
    );
  }

  const { id } = params;
  const accessToken = (session as unknown as { accessToken: string })
    .accessToken;
  const track = await getTrack(id, accessToken);

  const title: string = track.name;
  const artistNames: string = (track.artists || [])
    .map((a: { name: string }) => a.name)
    .join(", ");
  const albumImageUrl: string | undefined = track.album?.images?.[0]?.url;
  let previewUrl: string | null = null;
  const spotifyUrl: string | undefined = track.external_urls?.spotify;

  // Use internal preview finder API with absolute URL derived from headers
  if (!previewUrl) {
    try {
      const base = process.env.NEXTAUTH_URL;
      let origin = base && base.trim().length > 0 ? base : undefined;
      if (!origin) {
        // When running in Next.js App Router on the server, construct absolute origin safely
        // We prefer X-Forwarded-Proto/Host for deployments; fallback to localhost.
        const hdrs = nextHeaders();
        const proto = (await hdrs).get("x-forwarded-proto") ?? "http";
        const host =
          (await hdrs).get("x-forwarded-host") ??
          (await hdrs).get("host") ??
          "localhost:3000";
        origin = `${proto}://${host}`;
      }
      // helper to extract first URL from API payloads
      const extractUrl = (data: unknown): string | null => {
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
        if (typeof first?.preview_url === "string")
          urls.push(first.preview_url);
        if (Array.isArray(first?.previews)) urls.push(...first.previews);
        return urls[0] ?? null;
      };

      // 1) Try title + all artists
      let r = await fetch(
        `${origin}/api/preview?title=${encodeURIComponent(
          title
        )}&artist=${encodeURIComponent(artistNames)}&limit=1`,
        { cache: "no-store" }
      );
      if (r.ok) {
        const data = await r.json();
        previewUrl = extractUrl(data);
      }

      // 2) Try title + first artist
      if (!previewUrl) {
        const firstArtist = artistNames.split(",")[0]?.trim() ?? "";
        if (firstArtist) {
          r = await fetch(
            `${origin}/api/preview?title=${encodeURIComponent(
              title
            )}&artist=${encodeURIComponent(firstArtist)}&limit=1`,
            { cache: "no-store" }
          );
          if (r.ok) {
            const data = await r.json();
            previewUrl = extractUrl(data);
          }
        }
      }

      // 3) Try title only
      if (!previewUrl) {
        r = await fetch(
          `${origin}/api/preview?title=${encodeURIComponent(title)}&limit=1`,
          { cache: "no-store" }
        );
        if (r.ok) {
          const data = await r.json();
          previewUrl = extractUrl(data);
        }
      }
    } catch {}
  }

  // Conservative final fallback: use Spotify's own preview_url only if present on the fetched track payload.
  if (!previewUrl && typeof track.preview_url === "string") {
    previewUrl = track.preview_url as string;
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/">← Back</Link>
      </div>
      <TrackVisualClient
        title={title}
        artistNames={artistNames}
        albumImageUrl={albumImageUrl}
        previewUrl={previewUrl}
        spotifyUrl={spotifyUrl}
        spotifyId={id}
      />
    </div>
  );
}
