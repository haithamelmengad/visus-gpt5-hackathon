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
  return (
    <div>
      <TrackPlayer {...props} onLevelChange={setLevel} onPlayingChange={setIsPlaying} />
      <ThreeScene level={level} isPlaying={isPlaying} seed={`${props.title} ${props.artistNames}`} />
    </div>
  );
}


