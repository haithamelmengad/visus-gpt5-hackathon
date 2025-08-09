/**
 * Preview Finder API
 * ------------------
 * This endpoint returns 30s preview URLs using the community package
 * `spotify-preview-finder`.
 *
 * Important implementation notes (please keep):
 * - We MUST avoid a static import of `spotify-preview-finder` in dev, because
 *   the library depends on `undici` which expects a global `File` constructor
 *   in some Node.js environments. In dev/hot-reload, this may not be present
 *   early during module evaluation, causing "File is not defined" crashes.
 * - To make this robust, we polyfill a minimal `File` class first, and then
 *   dynamically import the library. This guarantees `File` exists before
 *   `undici` initializes.
 * - We normalize the library response to `{ success, searchQuery, results }`
 *   so clients can rely on one consistent shape.
 * - The library authenticates to Spotify using `SPOTIFY_CLIENT_ID` and
 *   `SPOTIFY_CLIENT_SECRET` from environment variables.
 */
import { NextResponse } from "next/server";
// Defer importing the package until after we polyfill `File` for Node environments
// where it's missing (undici expects it). We'll dynamically import below.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title");
  const artist = searchParams.get("artist");
  const limit = Number(searchParams.get("limit") || 3);

  if (!title) {
    return NextResponse.json({ error: "Missing title" }, { status: 400 });
  }

  try {
    // Polyfill global File if missing (Node 18 compatibility for undici)
    if (typeof (globalThis as any).File === "undefined") {
      class PolyfillFile extends Blob {
        name: string;
        lastModified: number;
        constructor(parts: any[] = [], name = "file", options?: any) {
          super(parts, options);
          this.name = String(name);
          this.lastModified = options?.lastModified ?? Date.now();
        }
      }
      (globalThis as any).File = PolyfillFile as unknown as typeof File;
    }

    const { default: finder } = await import("spotify-preview-finder");
    // The library returns an array-like structure of potential matches.
    // Normalize the response so clients can reliably read `results`.
    let result;
    if (artist) {
      result = await (finder as any)(
        title,
        artist,
        Math.max(1, Math.min(5, limit))
      );
    } else {
      result = await (finder as any)(title, Math.max(1, Math.min(5, limit)));
    }

    // Normalize to top-level results array for clients
    const normalizedResults = Array.isArray((result as any)?.results)
      ? (result as any).results
      : Array.isArray(result)
      ? (result as any)
      : [];
    const searchQuery = (result as any)?.searchQuery;
    return NextResponse.json({
      success: true,
      searchQuery,
      results: normalizedResults,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
