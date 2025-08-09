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
    preview_url?: string | null;
  };
  played_at: string;
};

export default function Home() {
  const { data: session, status } = useSession();
  const [items, setItems] = useState<RecentPlayedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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

  const gradientBg: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    background:
      "radial-gradient(60% 60% at 50% 20%, rgba(80,38,125,0.45) 0%, rgba(18,12,24,0.85) 48%, #07070a 100%)",
    padding: 24,
  };

  const panelStyle: React.CSSProperties = {
    width: 560,
    maxWidth: "100%",
    background: "linear-gradient(180deg, rgba(22,22,26,0.94), rgba(12,12,16,0.96))",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 18,
    boxShadow: "0 10px 40px rgba(0,0,0,0.55)",
    padding: 16,
    color: "#eaeaea",
  };

  const titleRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 10px 12px 10px",
  };

  const listStyle: React.CSSProperties = { listStyle: "none", padding: 6, margin: 0 };

  const footerStyle: React.CSSProperties = {
    textAlign: "center",
    marginTop: 14,
    color: "#9aa0a6",
    fontSize: 12,
  };

  const centerWrap: React.CSSProperties = {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  };

  if (!session) {
    return (
      <div style={gradientBg}>
        <div style={centerWrap}>
          <div style={panelStyle}>
            <div style={{ textAlign: "center", padding: 10 }}>
              <h2 style={{ margin: 0, fontSize: 32, lineHeight: 1.15 }}>Visualize your favorite<br/>music</h2>
              <div style={{ height: 16 }} />
              <button
                onClick={() => signIn("spotify")}
                style={{
                  display: "inline-block",
                  background: "#1DB954",
                  color: "#08130a",
                  fontWeight: 700,
                  border: "1px solid #1ed760",
                  borderRadius: 12,
                  padding: "14px 22px",
                  width: 360,
                  maxWidth: "100%",
                  boxShadow: "0 6px 20px rgba(29,185,84,0.35)",
                  cursor: "pointer",
                }}
              >
                Connect Spotify
              </button>
            </div>
          </div>
        </div>
        <div style={footerStyle}>[ stems labs ]</div>
      </div>
    );
  }

  return (
    <div style={gradientBg}>
      <div style={centerWrap}>
        <div style={panelStyle}>
          <div style={titleRowStyle}>
            <h2 style={{ margin: 0 }}>Recently Played</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => window.location.reload()}>Refresh</button>
              <button onClick={() => signOut()}>Sign out</button>
            </div>
          </div>

          {loading && <p style={{ padding: "0 10px" }}>Loading…</p>}
          {error && (
            <p style={{ padding: "0 10px", color: "#ff8585" }}>{error}</p>
          )}

          {items.length === 0 && !loading && !error && (
            <div style={{ color: "#9aa0a6", marginTop: 8, padding: "0 10px" }}>
              No recently played tracks returned. Try playing a track in Spotify, then click Refresh.
            </div>
          )}

          <ul style={listStyle}>
            {items.map((item, idx) => {
              const href = `/track/${encodeURIComponent(item.track.id)}?title=${encodeURIComponent(item.track.name)}`;
              const artistNames = item.track.artists.map((a) => a.name).join(", ");
              const hovered = hoverIdx === idx;
              const rowStyle: React.CSSProperties = {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderRadius: 12,
                border: hovered ? "1px solid rgba(255,255,255,0.35)" : "1px solid transparent",
                background: hovered ? "rgba(255,255,255,0.04)" : "transparent",
                transition: "background 160ms ease, border-color 160ms ease, transform 160ms ease",
              };
              const rightPill: React.CSSProperties = {
                marginLeft: 12,
                width: 28,
                height: 28,
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: hovered ? "#2a2a2f" : "#1b1b1f",
                color: "#d8d8de",
                border: "1px solid rgba(255,255,255,0.06)",
                flex: "0 0 auto",
              };
              return (
                <li key={`${item.track.id}-${item.played_at}`} style={{ marginBottom: 6 }}>
                  <a
                    href={href}
                    onMouseEnter={() => setHoverIdx(idx)}
                    onMouseLeave={() => setHoverIdx((curr) => (curr === idx ? null : curr))}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div style={rowStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <img
                          src={item.track.album.images?.[2]?.url || item.track.album.images?.[0]?.url || "/vercel.svg"}
                          alt={item.track.name}
                          width={48}
                          height={48}
                          style={{
                            borderRadius: 10,
                            objectFit: "cover",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}
                        />
                        <div>
                          <div style={{ fontSize: 12, color: "#9aa0a6", marginBottom: 2 }}>{artistNames}</div>
                          <div style={{ fontWeight: 600, color: "#f2f2f7" }}>{item.track.name}</div>
                        </div>
                      </div>
                      <div style={rightPill}>▶</div>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div style={footerStyle}>[ stems labs ]</div>
    </div>
  );
}
