import { useEffect, useState } from "react";

interface ShimmerTextProps {
  text: string;
}

/**
 * Animated shimmer text component that sweeps a highlight across the text
 */
export default function ShimmerText({ text }: ShimmerTextProps) {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const width = 3; // highlight width in characters

  useEffect(() => {
    const interval = setInterval(() => {
      setIdx((prev) => {
        const next = prev + dir;
        if (next < 0) {
          setDir(1);
          return 0;
        }
        if (next > Math.max(0, text.length - width)) {
          setDir(-1);
          return Math.max(0, text.length - width);
        }
        return next;
      });
    }, 90);
    return () => clearInterval(interval);
  }, [text, dir]);

  const start = Math.min(idx, Math.max(0, text.length - width));
  const end = Math.min(text.length, start + width);
  const left = text.slice(0, start);
  const mid = text.slice(start, end);
  const right = text.slice(end);

  return (
    <span style={{ fontWeight: 600, letterSpacing: 0.3 }}>
      <span style={{ color: "#9aa0a6" }}>{left}</span>
      <span
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(255,255,255,0.25), rgba(255,255,255,0.95), rgba(255,255,255,0.25))",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          textShadow: "0 0 18px rgba(255,255,255,0.15)",
        }}
      >
        {mid}
      </span>
      <span style={{ color: "#9aa0a6" }}>{right}</span>
    </span>
  );
}
