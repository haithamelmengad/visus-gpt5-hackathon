import Link from "next/link";
import ShimmerText from "@/components/ShimmerText";
import TrackPlayerSkeleton from "@/components/TrackPlayerSkeleton";
import { COLORS, PANELS } from "@/lib/styles";

export default function LoadingTrackPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        minHeight: 0,
      }}
    >
      {/* 3D Visualizer Area - Top (empty canvas area with centered loading text) */}
      <div
        style={{
          flex: 1,
          width: "100%",
          position: "relative",
          background: COLORS.background.gradient,
        }}
      >
        {/* Back button overlay (consistent with final page) */}
        <div
          style={{
            position: "absolute",
            top: 24,
            left: 24,
            zIndex: 10,
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 34,
          }}
        >
          <Link href="/" style={{ color: "#9aa0a6", textDecoration: "none" }}>
            ←
          </Link>
        </div>

        {/* Centered loading text */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              color: "#cfd3da",
              textAlign: "center",
              maxWidth: 880,
              width: "100%",
              padding: "0 16px",
            }}
          >
            <div style={{ fontSize: 20, lineHeight: 1.25 }}>
              <ShimmerText text="Loading visualizer…" />
            </div>
          </div>
        </div>
      </div>

      {/* Music Player - Bottom */}
      <div style={PANELS.player}>
        <div style={{ maxWidth: "500px", width: "100%" }}>
          <TrackPlayerSkeleton />
        </div>
      </div>
    </div>
  );
}
