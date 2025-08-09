// Shared VisualizerRecipe type for API and client
export type VisualizerRecipe = {
  // A short, vivid seed string optimized for procedural generation.
  // Keep it 5-12 tokens, avoid punctuation; use evocative nouns/adjectives.
  seed?: string;
  concept: string;
  rationale: string;
  baseGeometry: "sphere" | "box" | "plane" | "torus" | "cylinder" | "custom";
  // When baseGeometry is "custom", specify a supported kind so the client can construct it
  // Supported kinds: sunglasses | lightbulb | heart | star | bolt | vinyl | music_note
  customKind?:
    | "sunglasses"
    | "lightbulb"
    | "heart"
    | "star"
    | "bolt"
    | "vinyl"
    | "music_note";
  baseParams: Record<string, number>;
  colorPalette: string[];
  textureIdea?: string;
  deformation:
    | { type: "noise"; amplitude: number; frequency: number }
    | { type: "spike"; spikes: number; amplitude: number }
    | {
        type: "wave";
        axis: "x" | "y" | "z";
        amplitude: number;
        frequency: number;
      };
  audioMapping: {
    fftBands: { low: number; mid: number; high: number };
    spotifyWeights: Partial<{
      energy: number;
      valence: number;
      danceability: number;
      tempo: number;
      loudness: number;
      acousticness: number;
      instrumentalness: number;
      liveness: number;
      speechiness: number;
    }>;
  };
  fallbackPrompt?: string;
};
