"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import Image from "next/image";
import TrackListSkeleton from "@/components/TrackListSkeleton";
import LoginSkeleton from "@/components/LoginSkeleton";
import { COLORS, LAYOUTS, PANELS, BUTTONS } from "@/lib/styles";

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
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    async function load() {
      if (!session) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/spotify/recent?limit=50", {
          cache: "no-store",
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || `Request failed: ${res.status}`);
        }
        const data = await res.json();
        setItems(data.items ?? []);
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : "Failed to load";
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  const gradientBg: React.CSSProperties = {
    ...LAYOUTS.fullHeight,
    alignItems: "center",
    justifyContent: "flex-start",
    background: COLORS.background.gradient,
    padding: 24,
  };

  const centerWrap: React.CSSProperties = {
    flex: 1,
    ...LAYOUTS.centered,
    width: "100%",
  };

  const footerStyle: React.CSSProperties = {
    textAlign: "center",
    marginTop: 14,
    color: COLORS.text.muted,
    fontSize: 12,
  };

  const handleSignOut = () => {
    setIsLoggingOut(true);
    signOut({ callbackUrl: "/" });
  };

  if (status === "loading" || isLoggingOut) {
    return (
      <div style={gradientBg}>
        <div style={centerWrap}>
          <div style={PANELS.main}>
            <LoginSkeleton />
          </div>
        </div>
        <div style={footerStyle}>[ stems labs ]</div>
      </div>
    );
  }

  const titleRowStyle: React.CSSProperties = {
    ...LAYOUTS.spaceBetween,
    padding: "8px 10px 12px 10px",
  };

  const listStyle: React.CSSProperties = {
    listStyle: "none",
    padding: 6,
    margin: 0,
  };

  const signOutBtn: React.CSSProperties = {
    appearance: "none",
    background: "transparent",
    border: "none",
    outline: "none",
    padding: 6,
    margin: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    color: "#ffffff",
    cursor: "pointer",
  };

  if (!session) {
    // Dynamic glow animation keyframes
    const glowKeyframes = `
      @keyframes spotifyGlow {
        0% { box-shadow: 0 6px 20px rgba(29,185,84,0.35), 0 0 0 0 rgba(29,185,84,0.4); }
        50% { box-shadow: 0 8px 25px rgba(29,185,84,0.5), 0 0 20px 5px rgba(29,185,84,0.2); }
        100% { box-shadow: 0 6px 20px rgba(29,185,84,0.35), 0 0 0 0 rgba(29,185,84,0.4); }
      }
    `;

    const glowingSpotifyButton: React.CSSProperties = {
      ...BUTTONS.spotify,
      width: 280, // Reduced from 360
      animation: "spotifyGlow 2s ease-in-out infinite",
    };

    return (
      <>
        <style>{glowKeyframes}</style>
        <div style={gradientBg}>
          <div style={centerWrap}>
            <div style={PANELS.main}>
              <div style={{ textAlign: "center", padding: "10px 6px" }}>
                <h1
                  style={{
                    margin: 0,
                    lineHeight: 1.2,
                    fontWeight: 700,
                    color: COLORS.text.primary,
                  }}
                >
                  <Image
                    src="/Visus.svg"
                    alt="Visus"
                    width={138}
                    height={46}
                    priority
                  />
                </h1>
                <p
                  style={{
                    margin: "8px 0 0 0",
                    fontSize: 16,
                    lineHeight: 1.3,
                    color: COLORS.text.muted,
                    fontWeight: 400,
                  }}
                >
                  bring your music to life
                </p>
                <div style={{ height: 24 }} />
                <button
                  onClick={() => signIn("spotify")}
                  style={glowingSpotifyButton}
                >
                  Connect Spotify
                </button>
              </div>
            </div>
          </div>
          <div style={footerStyle}>[ stems labs ]</div>
        </div>
      </>
    );
  }

  return (
    <div style={gradientBg}>
      <div style={centerWrap}>
        <div style={PANELS.main}>
          <div style={titleRowStyle}>
            <h3 style={{ margin: 0 }}>Select a track</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleSignOut}
                style={signOutBtn}
                aria-label="Sign out"
                title="Sign out"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
          </div>

          {loading && <TrackListSkeleton count={8} />}
          {error && (
            <p style={{ padding: "0 10px", color: COLORS.text.error }}>
              {error}
            </p>
          )}

          {items.length === 0 && !loading && !error && (
            <div
              style={{
                color: COLORS.text.muted,
                marginTop: 8,
                padding: "0 10px",
              }}
            >
              No recently played tracks returned. Try playing a track in
              Spotify, then click Refresh.
            </div>
          )}

          <ul style={listStyle}>
            {items.map((item, idx) => {
              const href = `/track/${encodeURIComponent(
                item.track.id
              )}?title=${encodeURIComponent(item.track.name)}`;
              const artistNames = item.track.artists
                .map((a) => a.name)
                .join(", ");
              const hovered = hoverIdx === idx;
              const rowStyle: React.CSSProperties = {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderRadius: 12,
                border: hovered
                  ? "1px solid rgba(255,255,255,0.35)"
                  : "1px solid transparent",
                background: hovered ? "rgba(255,255,255,0.04)" : "transparent",
                transition:
                  "background 160ms ease, border-color 160ms ease, transform 160ms ease",
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
                border: COLORS.border.secondary,
                flex: "0 0 auto",
              };
              return (
                <li
                  key={`${item.track.id}-${item.played_at}`}
                  style={{ marginBottom: 6 }}
                >
                  <Link
                    href={href}
                    onMouseEnter={() => setHoverIdx(idx)}
                    onMouseLeave={() =>
                      setHoverIdx((curr) => (curr === idx ? null : curr))
                    }
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div style={rowStyle}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <img
                          src={
                            item.track.album.images?.[2]?.url ||
                            item.track.album.images?.[0]?.url ||
                            "/vercel.svg"
                          }
                          alt={item.track.name}
                          width={48}
                          height={48}
                          style={{
                            borderRadius: 10,
                            objectFit: "cover",
                            border: COLORS.border.primary,
                          }}
                        />
                        <div>
                          <div
                            style={{
                              fontSize: 12,
                              color: COLORS.text.muted,
                              marginBottom: 2,
                            }}
                          >
                            {artistNames}
                          </div>
                          <div
                            style={{
                              fontWeight: 600,
                              color: COLORS.text.primary,
                            }}
                          >
                            {item.track.name}
                          </div>
                        </div>
                      </div>
                      <div style={rightPill}>▶</div>
                    </div>
                  </Link>
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
