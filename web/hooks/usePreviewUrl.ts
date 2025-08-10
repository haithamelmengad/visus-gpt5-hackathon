import { useEffect, useState } from "react";

/**
 * Hook to resolve preview URL for tracks that don't have one
 */
export function usePreviewUrl(
  initialPreviewUrl: string | null,
  title: string,
  artistNames: string
): string | null {
  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState<string | null>(
    initialPreviewUrl
  );

  // Client-side fallback to resolve preview URL if SSR missed it
  useEffect(() => {
    if (resolvedPreviewUrl) return;

    let aborted = false;

    const fetchPreviewUrl = async () => {
      try {
        const response = await fetch(
          `/api/preview?title=${encodeURIComponent(
            title
          )}&artist=${encodeURIComponent(artistNames)}&limit=1`,
          { cache: "no-store" }
        );

        if (!response.ok) return;

        const data = await response.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        const first = results[0] ?? {};
        const urls: string[] = Array.isArray(first?.previewUrls)
          ? first.previewUrls
          : [];

        if (!aborted && urls.length > 0) {
          setResolvedPreviewUrl(urls[0]);
        }
      } catch {
        // ignore - fallback will handle this
      }
    };

    fetchPreviewUrl();
    return () => {
      aborted = true;
    };
  }, [resolvedPreviewUrl, title, artistNames]);

  return resolvedPreviewUrl;
}
