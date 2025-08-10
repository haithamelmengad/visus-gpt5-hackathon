/**
 * Shared style constants and utilities for consistent styling across components
 */

// Colors
export const COLORS = {
  background: {
    gradient:
      "radial-gradient(60% 60% at 50% 20%, rgba(80,38,125,0.45) 0%, rgba(18,12,24,0.85) 48%, #07070a 100%)",
    panel: "linear-gradient(180deg, rgba(22,22,26,0.94), rgba(12,12,16,0.96))",
    playerPanel: "rgba(14,14,18,0.94)",
  },
  text: {
    primary: "#f2f2f7",
    secondary: "#eaeaea",
    muted: "#9aa0a6",
    error: "#ff8585",
  },
  border: {
    primary: "1px solid rgba(255,255,255,0.08)",
    secondary: "1px solid rgba(255,255,255,0.06)",
  },
  ui: {
    skeleton: "linear-gradient(90deg, #2a2a2f 25%, #3a3a3f 50%, #2a2a2f 75%)",
    skeletonAlt: "#2a2a2f",
    spotifyGreen: "#1DB954",
    spotifyGreenBorder: "#1ed760",
  },
} as const;

// Common style objects
export const LAYOUTS = {
  fullHeight: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column" as const,
  },
  centered: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  spaceBetween: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
} as const;

export const PANELS = {
  main: {
    width: 560,
    maxWidth: "100%",
    background: COLORS.background.panel,
    border: COLORS.border.primary,
    borderRadius: 18,
    boxShadow: "0 10px 40px rgba(0,0,0,0.55)",
    padding: 16,
    color: COLORS.text.secondary,
  },
  player: {
    padding: "24px",
    background: COLORS.background.playerPanel,
    display: "flex",
    justifyContent: "center",
  },
} as const;

export const BUTTONS = {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 12,
    color: COLORS.text.secondary,
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    transition:
      "transform 120ms ease, box-shadow 120ms ease, background 160ms ease, border-color 160ms ease",
  },
  spotify: {
    display: "inline-block",
    background: COLORS.ui.spotifyGreen,
    color: "#08130a",
    fontWeight: 700,
    border: `1px solid ${COLORS.ui.spotifyGreenBorder}`,
    borderRadius: 12,
    padding: "14px 22px",
    width: 360,
    maxWidth: "100%",
    boxShadow: "0 6px 20px rgba(29,185,84,0.35)",
    cursor: "pointer",
  },
  control: {
    width: 34,
    height: 34,
    borderRadius: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1b1b1f",
    color: "#d8d8de",
    border: COLORS.border.secondary,
    cursor: "pointer",
  },
} as const;

// Animation constants
export const SHIMMER_KEYFRAMES = `
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
`;

// Utility functions
export const createShimmerStyle = (
  baseStyle: React.CSSProperties = {}
): React.CSSProperties => ({
  ...baseStyle,
  background: COLORS.ui.skeleton,
  backgroundSize: "200% 100%",
  animation: "shimmer 1.5s infinite",
});

export const formatTime = (sec: number): string => {
  if (!isFinite(sec) || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};
