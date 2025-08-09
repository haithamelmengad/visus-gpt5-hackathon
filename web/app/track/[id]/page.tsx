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
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        background: "radial-gradient(60% 60% at 50% 20%, rgba(80,38,125,0.45) 0%, rgba(18,12,24,0.85) 48%, #07070a 100%)" }}>
        <div style={{ width: 560, maxWidth: "100%", background: "rgba(14,14,18,0.94)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: 16 }}>
          <p style={{ color: "#eaeaea" }}>You must be signed in.</p>
          <Link href="/" style={{ color: "#9aa0a6" }}>Go home</Link>
        </div>
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
    <TrackVisualClient
      title={title}
      artistNames={artistNames}
      albumImageUrl={albumImageUrl}
      previewUrl={previewUrl}
      spotifyUrl={spotifyUrl}
    />
  );
}


