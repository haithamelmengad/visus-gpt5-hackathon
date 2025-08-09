"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  title: string;
  artistNames: string;
  albumImageUrl?: string;
  previewUrl?: string | null;
  spotifyUrl?: string;
  onLevelChange?: (level01: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
};

export default function TrackPlayer({ title, artistNames, albumImageUrl, previewUrl, spotifyUrl, onLevelChange, onPlayingChange }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [autoplayError, setAutoplayError] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!previewUrl) return;
    const audio = new Audio(previewUrl);
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    audio.volume = 1.0;
    audioRef.current = audio;
    // Setup Web Audio analyser for FFT/volume level
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        const analyserNode = analyserRef.current;
        const data = dataRef.current;
        if (analyserNode && data) {
          analyserNode.getByteTimeDomainData(data);
          let sumSquares = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128; // -1..1
            sumSquares += v * v;
          }
          const rms = Math.sqrt(sumSquares / data.length); // 0..1
          onLevelChange?.(Math.min(1, Math.max(0, rms)));
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      // Ensure AudioContext resumes once playback starts (user gesture)
      const onPlay = async () => {
        try {
          if (audioCtxRef.current?.state === "suspended") {
            await audioCtxRef.current.resume();
          }
        } catch {}
        onPlayingChange?.(true);
      };
      audio.addEventListener("play", onPlay);
      const onPause = () => onPlayingChange?.(false);
      audio.addEventListener("pause", onPause);
      audio.addEventListener("ended", onPause);

      // Cleanup
      return () => {
        try {
          audio.pause();
          audio.src = "";
        } catch {}
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        analyserRef.current?.disconnect();
        audioCtxRef.current?.close().catch(() => {});
        audio.removeEventListener("play", onPlay);
        audio.removeEventListener("pause", onPause);
        audio.removeEventListener("ended", onPause);
        onPlayingChange?.(false);
      };
    } catch {}

    // Try autoplay on mount after setting up context
    audio.play().then(() => {
      onPlayingChange?.(true);
    }).catch(async (err) => {
      setAutoplayError(err?.message || "Autoplay was blocked");
      try {
        if (audioCtxRef.current?.state === "suspended") {
          await audioCtxRef.current.resume();
        }
      } catch {}
    });

    // Secondary cleanup if try block failed early
    return () => {
      try {
        audio.pause();
        audio.src = "";
      } catch {}
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      analyserRef.current?.disconnect();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [previewUrl]);

  const handleManualPlay = async () => {
    if (!audioRef.current && previewUrl) {
      audioRef.current = new Audio(previewUrl);
    }
    try {
      if (audioCtxRef.current?.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      await audioRef.current?.play();
      setAutoplayError(null);
      onPlayingChange?.(true);
    } catch (e: any) {
      setAutoplayError(e?.message || "Failed to play");
    }
  };

  const handlePause = () => {
    audioRef.current?.pause();
    onPlayingChange?.(false);
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


