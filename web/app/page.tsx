"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";

type RecentPlayedItem = {
  track: {
    id: string;
    name: string;
    artists: { name: string }[];
    album: { name: string; images?: { url: string }[] };
    external_urls?: { spotify?: string };
  };
  played_at: string;
};

export default function Home() {
  const { data: session, status } = useSession();
  const [items, setItems] = useState<RecentPlayedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!session) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/spotify/recent?limit=50", { cache: "no-store" });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || `Request failed: ${res.status}`);
        }
        const data = await res.json();
        setItems(data.items ?? []);
      } catch (e: any) {
        setError(e.message ?? "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  if (status === "loading") {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  if (!session) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Spotify Recently Played</h1>
        <button onClick={() => signIn("spotify")}>Sign in with Spotify</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Recently Played</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.location.reload()}>Refresh</button>
          <button onClick={() => signOut()}>Sign out</button>
        </div>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {items.length === 0 && !loading && !error && (
        <div style={{ color: "#666", marginTop: 12 }}>
          No recently played tracks returned. Try playing a track in Spotify, then click Refresh.
        </div>
      )}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {items.map((item) => {
          const href = `/track/${encodeURIComponent(item.track.id)}?title=${encodeURIComponent(item.track.name)}`;
          return (
            <li key={`${item.track.id}-${item.played_at}`} style={{ marginBottom: 12 }}>
              <a href={href} style={{ display: "flex", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}>
                <img
                  src={item.track.album.images?.[2]?.url || item.track.album.images?.[0]?.url || "/vercel.svg"}
                  alt={item.track.name}
                  width={48}
                  height={48}
                  style={{ borderRadius: 4, objectFit: "cover" }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>{item.track.name}</div>
                  <div style={{ color: "#666" }}>
                    {item.track.artists.map((a) => a.name).join(", ")} – {item.track.album.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#888" }}>Played at {new Date(item.played_at).toLocaleString()}</div>
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
