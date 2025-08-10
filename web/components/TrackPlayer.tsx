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
  onAnalyserReady?: (analyser: AnalyserNode) => void;
};

export default function TrackPlayer({
  title,
  artistNames,
  albumImageUrl,
  previewUrl,
  spotifyUrl,
  onLevelChange,
  onPlayingChange,
  onAnalyserReady,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [autoplayError, setAutoplayError] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const rafRef = useRef<number | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

  // Keep a persistent <audio> element and set its src when previewUrl changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // reset
    try {
      audio.pause();
    } catch {}
    if (!previewUrl) {
      audio.removeAttribute("src");
      setDurationSec(0);
      setCurrentTimeSec(0);
      return;
    }
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    audio.src = previewUrl;
    setAutoplayError(null);
  }, [previewUrl]);

  // Attach media event listeners once
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = async () => {
      try {
        if (audioCtxRef.current?.state === "suspended") {
          await audioCtxRef.current.resume();
        }
      } catch {}
      onPlayingChange?.(true);
    };
    const onPause = () => onPlayingChange?.(false);
    const onLoaded = () => setDurationSec(audio.duration || 0);
    const onTime = () => setCurrentTimeSec(audio.currentTime || 0);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTime);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTime);
    };
  }, [onPlayingChange]);

  const handleManualPlay = async () => {
    const audio = audioRef.current;
    if (!audio || !previewUrl) return;
    try {
      // Lazily create AudioContext and analyser on first play to satisfy policies
      if (!audioCtxRef.current) {
        const ctx = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024; // Larger FFT for smoother frequency resolution
        analyser.smoothingTimeConstant = 0.9; // Higher smoothing for more uniform data
        source.connect(analyser);
        analyser.connect(ctx.destination);
        analyserRef.current = analyser;
        dataRef.current = new Uint8Array(analyser.frequencyBinCount);
        // Expose analyser
        try {
          onAnalyserReady?.(analyser);
        } catch {}
        // Start RMS loop
        const tick = () => {
          const analyserNode = analyserRef.current;
          const data = dataRef.current;
          if (analyserNode && data) {
            // Cast to satisfy TS generic mismatch between ArrayBuffer and ArrayBufferLike in lib types
            analyserNode.getByteFrequencyData(
              data as unknown as Uint8Array<ArrayBuffer>
            );
            // Simple energy: average of bins
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const avg = sum / (data.length * 255);
            onLevelChange?.(Math.min(1, Math.max(0, avg)));
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      await audio.play();
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
    const fraction = Math.min(
      1,
      Math.max(0, (evt.clientX - bar.left) / bar.width)
    );
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
    width:
      durationSec > 0
        ? `${Math.min(100, (currentTimeSec / durationSec) * 100)}%`
        : "0%",
    transition: "width 100ms linear",
  };

  return (
    <div>
      {/* Hidden native audio element for robust playback */}
      <audio ref={audioRef} playsInline />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {albumImageUrl && (
            <img
              src={albumImageUrl}
              alt={title}
              width={64}
              height={64}
              style={{
                borderRadius: 12,
                objectFit: "cover",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            />
          )}
          <div>
            <div style={{ fontSize: 12, color: "#9aa0a6" }}>{artistNames}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f2f2f7" }}>
              {title}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {spotifyUrl && (
            <div style={{ display: "flex", alignItems: "center" }}>
              <a
                href={spotifyUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open in Spotify"
                title="Open in Spotify"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 34,
                  height: 34,
                  borderRadius: 18,
                  background: "#1DB954",
                }}
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" fill="#1DB954" />
                  <path
                    d="M7 8c4-1 8.5-0.5 12 1.5"
                    stroke="#0f1115"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    d="M7.5 11c3.5-0.8 7-0.4 10 1"
                    stroke="#0f1115"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    d="M8 14c2.5-0.5 5-0.2 7 0.8"
                    stroke="#0f1115"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </a>
            </div>
          )}
          {previewUrl ? (
            audioRef.current && !audioRef.current.paused ? (
              <button
                onClick={handlePause}
                aria-label="Pause"
                style={controlPillBase}
              >
                ❚❚
              </button>
            ) : (
              <button
                onClick={handleManualPlay}
                aria-label="Play"
                style={controlPillBase}
              >
                ▶
              </button>
            )
          ) : (
            <div
              style={{
                ...controlPillBase,
                opacity: 0.5,
                cursor: "not-allowed",
              }}
            >
              –
            </div>
          )}
        </div>
      </div>

      <div style={{ height: 12 }} />

      {previewUrl ? (
        <div>
          <div onClick={handleSeek} style={progressOuter}>
            <div style={progressInner} />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 6,
              color: "#9aa0a6",
              fontSize: 12,
            }}
          >
            <span>{formatTime(currentTimeSec)}</span>
            <span>{formatTime(durationSec)}</span>
          </div>
          {autoplayError && (
            <div style={{ marginTop: 6, color: "#f88", fontSize: 12 }}>
              (Autoplay blocked — click Play)
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: "#888" }}>
          No 30s preview available for this track.
        </div>
      )}
      <div
        style={{
          marginTop: 32,
          color: "#9aa0a6",
          fontSize: 12,
          textAlign: "center",
        }}
      >
        [stems labs]
      </div>
    </div>
  );
}
