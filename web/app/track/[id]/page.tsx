import Link from "next/link";
import TrackVisualClient from "@/components/TrackVisualClient";

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

export default async function TrackPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || !(session as any).accessToken) {
    return (
      <div style={{ padding: 24 }}>
        <p>You must be signed in.</p>
        <Link href="/">Go home</Link>
      </div>
    );
  }

  const { id } = params;
  const track = await getTrack(id, (session as any).accessToken as string);

  const title: string = track.name;
  const artistNames: string = (track.artists || []).map((a: any) => a.name).join(", ");
  const albumImageUrl: string | undefined = track.album?.images?.[0]?.url;
  let previewUrl: string | null = track.preview_url;
  const spotifyUrl: string | undefined = track.external_urls?.spotify;

  // Fallback: use preview finder if official preview_url is missing
  if (!previewUrl) {
    try {
      const r = await fetch(
        `${process.env.NEXTAUTH_URL || ""}/api/preview?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artistNames)}&limit=1`,
        { cache: "no-store" }
      );
      if (r.ok) {
        const data = await r.json();
        if (data?.success && Array.isArray(data.results) && data.results[0]?.previewUrls?.length > 0) {
          previewUrl = data.results[0].previewUrls[0] as string;
        }
      }
    } catch {}
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
      />
    </div>
  );
}


