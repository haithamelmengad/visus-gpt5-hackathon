"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  title: string;
  artistNames: string;
  albumImageUrl?: string;
  previewUrl?: string | null;
  spotifyUrl?: string;
};

export default function TrackPlayer({ title, artistNames, albumImageUrl, previewUrl, spotifyUrl }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [autoplayError, setAutoplayError] = useState<string | null>(null);

  useEffect(() => {
    if (!previewUrl) return;
    const audio = new Audio(previewUrl);
    audioRef.current = audio;
    // Try autoplay on mount
    audio.play().catch((err) => {
      setAutoplayError(err?.message || "Autoplay was blocked");
    });
    return () => {
      try {
        audio.pause();
        audio.src = "";
      } catch {}
    };
  }, [previewUrl]);

  const handleManualPlay = async () => {
    if (!audioRef.current && previewUrl) {
      audioRef.current = new Audio(previewUrl);
    }
    try {
      await audioRef.current?.play();
      setAutoplayError(null);
    } catch (e: any) {
      setAutoplayError(e?.message || "Failed to play");
    }
  };

  const handlePause = () => {
    audioRef.current?.pause();
  };

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      {albumImageUrl && (
        <img src={albumImageUrl} alt={title} width={120} height={120} style={{ borderRadius: 8, objectFit: "cover" }} />
      )}
      <div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{title}</div>
        <div style={{ color: "#aaa", marginBottom: 8 }}>{artistNames}</div>
        {previewUrl ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={handleManualPlay}>Play</button>
            <button onClick={handlePause}>Pause</button>
            {autoplayError && <span style={{ color: "#f88" }}>(Autoplay blocked — click Play)</span>}
          </div>
        ) : (
          <div style={{ color: "#888" }}>No 30s preview available for this track.</div>
        )}
        {spotifyUrl && (
          <div style={{ marginTop: 8 }}>
            <a href={spotifyUrl} target="_blank" rel="noreferrer">Open in Spotify</a>
          </div>
        )}
      </div>
    </div>
  );
}


