import React from "react";

interface LoginSkeletonProps {
  className?: string;
}

/**
 * Skeleton component for the login component that shows during loading states
 * and logout transitions, matching the visual structure of the actual login UI
 */
export default function LoginSkeleton({ className = "" }: LoginSkeletonProps) {
  const shimmerStyle: React.CSSProperties = {
    background: "linear-gradient(90deg, #2a2a2f 25%, #3a3a3f 50%, #2a2a2f 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
    borderRadius: "inherit",
  };

  const titleSkeletonStyle: React.CSSProperties = {
    ...shimmerStyle,
    height: 32,
    width: 280,
    margin: "0 auto 16px auto",
    borderRadius: 8,
  };

  const buttonSkeletonStyle: React.CSSProperties = {
    ...shimmerStyle,
    height: 48,
    width: 360,
    maxWidth: "100%",
    borderRadius: 12,
    margin: "0 auto",
  };

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
