import React from "react";
import { createShimmerStyle, COLORS } from "@/lib/styles";

interface TrackListSkeletonProps {
  count?: number;
  className?: string;
}

/**
 * Skeleton component for the tracklist that shows loading placeholders
 * matching the visual structure of actual track items
 */
export default function TrackListSkeleton({
  count = 5,
  className = "",
}: TrackListSkeletonProps) {
  const skeletonItems = Array.from({ length: count }, (_, index) => index);

  const skeletonItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid transparent",
    background: "transparent",
    marginBottom: 6,
  };

  const albumImageSkeletonStyle = createShimmerStyle({
    width: 48,
    height: 48,
    borderRadius: 10,
    border: COLORS.border.primary,
  });

  const titleSkeletonStyle = createShimmerStyle({
    height: 12,
    width: 160,
    marginBottom: 2,
    borderRadius: 6,
  });

  const artistSkeletonStyle = createShimmerStyle({
    height: 12,
    width: 120,
    borderRadius: 6,
  });

  const playButtonSkeletonStyle = createShimmerStyle({
    width: 28,
    height: 28,
    borderRadius: 16,
    border: COLORS.border.secondary,
  });

  return (
    <div className={className}>
      <style jsx>{`
        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }
      `}</style>

      <ul style={{ listStyle: "none", padding: 6, margin: 0 }}>
        {skeletonItems.map((index) => (
          <li key={index} style={{ marginBottom: 6 }}>
            <div style={skeletonItemStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* Album image skeleton */}
                <div style={albumImageSkeletonStyle} />

                {/* Text content skeleton */}
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 2 }}
                >
                  <div style={artistSkeletonStyle} />
                  <div style={titleSkeletonStyle} />
                </div>
              </div>

              {/* Play button skeleton */}
              <div style={playButtonSkeletonStyle} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
