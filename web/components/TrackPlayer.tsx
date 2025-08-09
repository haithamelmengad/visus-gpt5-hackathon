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
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

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

      const onLoaded = () => setDurationSec(audio.duration || 0);
      const onTime = () => setCurrentTimeSec(audio.currentTime || 0);
      audio.addEventListener("loadedmetadata", onLoaded);
      audio.addEventListener("timeupdate", onTime);

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
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("timeupdate", onTime);
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

  const handleSeek = (evt: React.MouseEvent<HTMLDivElement>) => {
    const bar = evt.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (evt.clientX - bar.left) / bar.width));
    if (audioRef.current && durationSec > 0) {
      audioRef.current.currentTime = fraction * durationSec;
      setCurrentTimeSec(audioRef.current.currentTime);
    }
  };

  const formatTime = (sec: number) => {
    if (!isFinite(sec) || sec <= 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const controlPillBase: React.CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1b1b1f",
    color: "#d8d8de",
    border: "1px solid rgba(255,255,255,0.06)",
    cursor: "pointer",
  };

  const progressOuter: React.CSSProperties = {
    width: "100%",
    height: 6,
    borderRadius: 999,
    background: "#2a2a2f",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.05)",
  };
  const progressInner: React.CSSProperties = {
    height: "100%",
    borderRadius: 999,
    background: "#9aa0a6",
    width: durationSec > 0 ? `${Math.min(100, (currentTimeSec / durationSec) * 100)}%` : "0%",
    transition: "width 100ms linear",
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {albumImageUrl && (
            <img
              src={albumImageUrl}
              alt={title}
              width={64}
              height={64}
              style={{ borderRadius: 12, objectFit: "cover", border: "1px solid rgba(255,255,255,0.08)" }}
            />)
          }
          <div>
            <div style={{ fontSize: 12, color: "#9aa0a6" }}>{artistNames}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f2f2f7" }}>{title}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => window.history.back()} aria-label="Back" style={controlPillBase}>
            <span style={{ display: "inline-block", fontSize: 18 }}>↩</span>
          </button>
          {previewUrl ? (
            audioRef.current && !audioRef.current.paused ? (
              <button onClick={handlePause} aria-label="Pause" style={controlPillBase}>❚❚</button>
            ) : (
              <button onClick={handleManualPlay} aria-label="Play" style={controlPillBase}>▶</button>
            )
          ) : (
            <div style={{ ...controlPillBase, opacity: 0.5, cursor: "not-allowed" }}>–</div>
          )}
        </div>
      </div>

      <div style={{ height: 12 }} />

      {previewUrl ? (
        <div>
          <div onClick={handleSeek} style={progressOuter}>
            <div style={progressInner} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, color: "#9aa0a6", fontSize: 12 }}>
            <span>{formatTime(currentTimeSec)}</span>
            <span>{formatTime(durationSec)}</span>
          </div>
          {autoplayError && <div style={{ marginTop: 6, color: "#f88", fontSize: 12 }}>(Autoplay blocked — click Play)</div>}
        </div>
      ) : (
        <div style={{ color: "#888" }}>No 30s preview available for this track.</div>
      )}

      {spotifyUrl && (
        <div style={{ marginTop: 8 }}>
          <a href={spotifyUrl} target="_blank" rel="noreferrer" style={{ color: "#9aa0a6", fontSize: 12 }}>Open in Spotify</a>
        </div>
      )}
    </div>
  );
}


