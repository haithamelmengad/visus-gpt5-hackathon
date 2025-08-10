"use client";

import { useEffect, useRef, useState } from "react";
import { formatTime, BUTTONS } from "@/lib/styles";
import { createAudioContext, createAnalyser } from "@/lib/audio";

type Props = {
  title: string;
  artistNames: string;
  albumImageUrl?: string;
  previewUrl?: string | null;
  spotifyUrl?: string;
  onLevelChange?: (level01: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onAnalyserReady?: (analyser: AnalyserNode) => void;
  // When this number changes, attempt to autoplay
  autoPlaySignal?: number;
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
  autoPlaySignal,
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

  // Attempt autoplay when requested by parent
  const lastAutoPlaySignalRef = useRef<number | null>(null);
  useEffect(() => {
    if (typeof autoPlaySignal !== "number") return;
    if (lastAutoPlaySignalRef.current === autoPlaySignal) return;
    lastAutoPlaySignalRef.current = autoPlaySignal;
    // Only try if we have a preview URL
    if (!previewUrl) return;
    // Fire and forget; errors are handled within handleManualPlay
    void handleManualPlay();
  }, [autoPlaySignal, previewUrl]);

  const handleManualPlay = async () => {
    const audio = audioRef.current;
    if (!audio || !previewUrl) return;
    try {
      // Lazily create AudioContext and analyser on first play to satisfy policies
      if (!audioCtxRef.current) {
        const ctx = createAudioContext();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaElementSource(audio);
        // Make analyser a bit more responsive by reducing smoothing and widening dB range
        const analyser = createAnalyser(ctx, 1024, {
          smoothingTimeConstant: 0.6,
          minDecibels: -85,
          maxDecibels: -20,
        });
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

  const controlPillBase = BUTTONS.control;

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
                  background: "transparent",
                }}
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 496 512"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    fill="#1ed760"
                    d="M248 8C111.1 8 0 119.1 0 256s111.1 248 248 248 248-111.1 248-248S384.9 8 248 8Z"
                  />
                  <path
                    fill="#000"
                    d="M406.6 231.1c-5.2 0-8.4-1.3-12.9-3.9-71.2-42.5-198.5-52.7-280.9-29.7-3.6 1-8.1 2.6-12.9 2.6-13.2 0-23.3-10.3-23.3-23.6 0-13.6 8.4-21.3 17.4-23.9 35.2-10.3 74.6-15.2 117.5-15.2 73 0 149.5 15.2 205.4 47.8 7.8 4.5 12.9 10.7 12.9 22.6 0 13.6-11 23.3-23.2 23.3zm-31 76.2c-5.2 0-8.7-2.3-12.3-4.2-62.5-37-155.7-51.9-238.6-29.4-4.8 1.3-7.4 2.6-11.9 2.6-10.7 0-19.4-8.7-19.4-19.4s5.2-17.8 15.5-20.7c27.8-7.8 56.2-13.6 97.8-13.6 64.9 0 127.6 16.1 177 45.5 8.1 4.8 11.3 11 11.3 19.7-.1 10.8-8.5 19.5-19.4 19.5zm-26.9 65.6c-4.2 0-6.8-1.3-10.7-3.6-62.4-37.6-135-39.2-206.7-24.5-3.9 1-9 2.6-11.9 2.6-9.7 0-15.8-7.7-15.8-15.8 0-10.3 6.1-15.2 13.6-16.8 81.9-18.1 165.6-16.5 237 26.2 6.1 3.9 9.7 7.4 9.7 16.5s-7.1 15.4-15.2 15.4z"
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
