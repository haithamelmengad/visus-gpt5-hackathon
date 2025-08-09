"use client";

import { useState } from "react";
import TrackPlayer from "@/components/TrackPlayer";
import ThreeScene from "@/components/ThreeScene";

type Props = {
  title: string;
  artistNames: string;
  albumImageUrl?: string;
  previewUrl?: string | null;
  spotifyUrl?: string;
};

export default function TrackVisualClient(props: Props) {
  const [level, setLevel] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
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

  const centerWrap: React.CSSProperties = {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  };

  const playerCardStyle: React.CSSProperties = {
    width: 560,
    maxWidth: "100%",
    background: "linear-gradient(180deg, rgba(22,22,26,0.94), rgba(12,12,16,0.96))",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 18,
    boxShadow: "0 10px 40px rgba(0,0,0,0.55)",
    padding: 16,
    color: "#eaeaea",
  };

  return (
    <div style={gradientBg}>
      <div style={centerWrap}>
        <ThreeScene level={level} isPlaying={isPlaying} seed={`${props.title} ${props.artistNames}`} />
      </div>
      <div style={playerCardStyle}>
        <TrackPlayer {...props} onLevelChange={setLevel} onPlayingChange={setIsPlaying} />
      </div>
    </div>
  );
}


