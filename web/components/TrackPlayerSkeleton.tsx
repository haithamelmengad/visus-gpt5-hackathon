import React from "react";
import {
  COLORS,
  PANELS,
  SHIMMER_KEYFRAMES,
  createShimmerStyle,
} from "@/lib/styles";

interface TrackPlayerSkeletonProps {
  className?: string;
}

/**
 * Skeleton placeholder that mirrors the basic layout of `TrackPlayer`.
 * Shows shimmering blocks for album art, text, controls and the progress bar.
 */
export default function TrackPlayerSkeleton({
  className = "",
}: TrackPlayerSkeletonProps) {
  const containerStyle: React.CSSProperties = {
    width: "100%",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  };

  const leftWrapStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
  };

  const albumSkeleton = createShimmerStyle({
    width: 64,
    height: 64,
    borderRadius: 12,
    border: COLORS.border.primary,
  });

  const artistSkeleton = createShimmerStyle({
    height: 12,
    width: 140,
    borderRadius: 6,
    marginBottom: 6,
  });

  const titleSkeleton = createShimmerStyle({
    height: 16,
    width: 220,
    borderRadius: 8,
  });

  const controlSkeleton = createShimmerStyle({
    width: 34,
    height: 34,
    borderRadius: 18,
    border: COLORS.border.secondary,
  });

  const progressOuter: React.CSSProperties = {
    width: "100%",
    height: 6,
    borderRadius: 999,
    background: COLORS.ui.skeletonAlt,
    overflow: "hidden",
    border: COLORS.border.primary,
  };

  const progressInner = createShimmerStyle({
    height: "100%",
    width: "66%",
    borderRadius: 999,
  });

  const timeRow: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 6,
  };

  const timeSkeleton = createShimmerStyle({
    height: 10,
    width: 36,
    borderRadius: 6,
  });

  const footerSkeleton = createShimmerStyle({
    height: 10,
    width: 90,
    borderRadius: 6,
    margin: "24px auto 0 auto",
  });

  return (
    <div className={className} style={containerStyle}>
      <style>{SHIMMER_KEYFRAMES}</style>
      <div style={rowStyle}>
        <div style={leftWrapStyle}>
          <div style={albumSkeleton} />
          <div>
            <div style={artistSkeleton} />
            <div style={titleSkeleton} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={controlSkeleton} />
          <div
            style={createShimmerStyle({
              width: 34,
              height: 34,
              borderRadius: 18,
              border: COLORS.border.secondary,
            })}
          />
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div>
        <div style={progressOuter}>
          <div style={progressInner} />
        </div>
        <div style={timeRow}>
          <div style={timeSkeleton} />
          <div style={timeSkeleton} />
        </div>
      </div>

      <div style={footerSkeleton} />
    </div>
  );
}
