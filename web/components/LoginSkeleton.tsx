import React from "react";
import { createShimmerStyle } from "@/lib/styles";

interface LoginSkeletonProps {
  className?: string;
}

/**
 * Skeleton component for the login component that shows during loading states
 * and logout transitions, matching the visual structure of the actual login UI
 */
export default function LoginSkeleton({ className = "" }: LoginSkeletonProps) {
  const titleSkeletonStyle = createShimmerStyle({
    height: 32,
    width: 280,
    margin: "0 auto 16px auto",
    borderRadius: 8,
  });

  const buttonSkeletonStyle = createShimmerStyle({
    height: 48,
    width: 360,
    maxWidth: "100%",
    borderRadius: 12,
    margin: "0 auto",
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

      <div style={{ textAlign: "center", padding: 10 }}>
        {/* Title skeleton - two lines to match the "Visualize your favorite music" text */}
        <div style={{ marginBottom: 16 }}>
          <div style={titleSkeletonStyle} />
          <div style={{ height: 8 }} />
          <div style={{ ...titleSkeletonStyle, width: 200 }} />
        </div>

        {/* Button skeleton */}
        <div style={buttonSkeletonStyle} />
      </div>
    </div>
  );
}
