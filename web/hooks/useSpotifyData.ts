import { useEffect, useMemo, useState } from "react";
import type { VisualizerRecipe } from "@/types/visualizer";

export type SpotifyFeatures = Record<
  string,
  number | string | null | undefined
>;

export interface SpotifyDataResult {
  features: SpotifyFeatures | null;
  recipe: VisualizerRecipe | null;
  error: string | null;
  isLoading: boolean;
}

/**
 * Hook to fetch Spotify features and visualizer recipe
 */
export function useSpotifyData(
  spotifyId?: string,
  title?: string,
  artistNames?: string
): SpotifyDataResult {
  const [features, setFeatures] = useState<SpotifyFeatures | null>(null);
  const [recipe, setRecipe] = useState<VisualizerRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch visualizer recipe
  useEffect(() => {
    if (!spotifyId || !title || !artistNames) return;
    let aborted = false;
    setIsLoading(true);

    const fetchRecipe = async () => {
      try {
        const response = await fetch(`/api/visualizer/recipe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spotifyId,
            title,
            artist: artistNames,
            includeAnalysis: false,
            skipEnrichment: true,
          }),
        });

        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as VisualizerRecipe;

        if (!aborted) {
          setRecipe(data);
          setError(null);
        }
      } catch (e) {
        if (!aborted) {
          setError(e instanceof Error ? e.message : "Failed to get recipe");
        }
      } finally {
        if (!aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchRecipe();
    return () => {
      aborted = true;
    };
  }, [spotifyId, title, artistNames]);

  return { features, recipe, error, isLoading };
}

/**
 * Hook to compute Spotify scalar from features and recipe weights
 */
export function useSpotifyScalar(
  features: SpotifyFeatures | null,
  recipe: VisualizerRecipe | null
): number {
  return useMemo(() => {
    const weights = recipe?.audioMapping.spotifyWeights ?? {};
    const entries = Object.entries(weights) as Array<
      [keyof SpotifyFeatures, number]
    >;
    return entries.reduce((acc, [k, w]) => {
      const base = features?.[k];
      const v = typeof base === "number" ? base : 0;
      return acc + v * w;
    }, 0);
  }, [features, recipe]);
}
