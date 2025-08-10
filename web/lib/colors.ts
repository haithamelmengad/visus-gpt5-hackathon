import * as THREE from "three";

/**
 * Color utilities for consistent color handling across the application
 */

export type ColorPalette = string[];

export interface ColorHSL {
  h: number;
  s: number;
  l: number;
}

export const hexToColorVec3 = (hex: string): THREE.Vector3 => {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return new THREE.Vector3(r, g, b);
};

export const pickPrimaryColor = (palette?: ColorPalette): string => {
  const arr = Array.isArray(palette) ? palette : [];
  if (arr.length === 0) return "#ffffff";

  let best = arr[0];
  let bestY = -1;

  for (const hex of arr) {
    const c = (hex || "").toString();
    const h = c.startsWith("#") ? c.slice(1) : c;
    if (h.length < 6) continue;

    const rr = parseInt(h.slice(0, 2), 16) / 255;
    const gg = parseInt(h.slice(2, 4), 16) / 255;
    const bb = parseInt(h.slice(4, 6), 16) / 255;
    const y = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb; // relative luminance

    if (y > bestY) {
      bestY = y;
      best = c;
    }
  }

  // Ensure it's not near-black
  if (bestY < 0.18) return "#9C27B0"; // pleasant purple fallback
  return best;
};

export const generateSongColors = (
  title: string,
  artistNames: string
): THREE.Color => {
  // Use track title and artist for deterministic but varied colors
  const seed = `${title}${artistNames}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) & 0xffffffff;
  }

  // Generate vibrant, varied colors
  const hue = (hash % 360) / 360;
  const saturation = 0.6 + ((hash >> 8) % 40) / 100; // 0.6-1.0
  const lightness = 0.4 + ((hash >> 16) % 30) / 100; // 0.4-0.7

  return new THREE.Color().setHSL(hue, saturation, lightness);
};

export const generateComplementaryColors = (
  baseColor: THREE.Color
): THREE.Color[] => {
  const hsl: ColorHSL = { h: 0, s: 0, l: 0 };
  baseColor.getHSL(hsl);

  const complementary = new THREE.Color().setHSL(
    (hsl.h + 0.5) % 1,
    hsl.s,
    hsl.l
  );
  const analogous1 = new THREE.Color().setHSL(
    (hsl.h + 0.083) % 1,
    hsl.s,
    hsl.l
  );
  const analogous2 = new THREE.Color().setHSL(
    (hsl.h - 0.083 + 1) % 1,
    hsl.s,
    hsl.l
  );

  return [complementary, analogous1, analogous2];
};

export const extractDominantColors = async (
  imageUrl: string
): Promise<THREE.Color[]> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve([new THREE.Color(0x9c27b0)]); // Fallback purple
        return;
      }

      // Scale down for performance
      const scale = 0.1;
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Simple color clustering
      const colors: { r: number; g: number; b: number; count: number }[] = [];
      const tolerance = 30; // Color similarity threshold

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Skip very dark or very light pixels
        const brightness = (r + g + b) / 3;
        if (brightness < 30 || brightness > 225) continue;

        let found = false;
        for (const color of colors) {
          const dr = Math.abs(r - color.r);
          const dg = Math.abs(g - color.g);
          const db = Math.abs(b - color.b);

          if (dr + dg + db < tolerance) {
            color.count++;
            found = true;
            break;
          }
        }

        if (!found) {
          colors.push({ r, g, b, count: 1 });
        }
      }

      // Sort by frequency and take top colors
      colors.sort((a, b) => b.count - a.count);
      const dominantColors = colors
        .slice(0, 5)
        .map(
          (color) =>
            new THREE.Color(color.r / 255, color.g / 255, color.b / 255)
        );

      if (dominantColors.length === 0) {
        dominantColors.push(new THREE.Color(0x9c27b0)); // Fallback
      }

      resolve(dominantColors);
    };

    img.onerror = () => {
      resolve([new THREE.Color(0x9c27b0)]); // Fallback on error
    };

    img.src = imageUrl;
  });
};
