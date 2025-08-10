import { NextResponse } from "next/server";
import { z } from "zod";
import { cacheGet, cacheSet } from "@/lib/cache";

const inputSchema = z.object({
  spotifyId: z.string().min(1),
  fftData: z.object({
    low: z.number().min(0).max(255),
    mid: z.number().min(0).max(255),
    high: z.number().min(0).max(255),
    energy: z.number().min(0).max(1),
    timestamp: z.number(),
  }),
  animationParams: z
    .object({
      intensity: z.number().min(0).max(1).optional(),
      speed: z.number().min(0).max(2).optional(),
      blendMode: z.enum(["additive", "multiply", "replace"]).optional(),
    })
    .optional(),
});

/**
 * Meshy Animation Control API
 *
 * This endpoint processes FFT data and returns animation parameters
 * for controlling rigged 3D models in real-time.
 *
 * The endpoint:
 * - Receives FFT frequency data from the audio analyzer
 * - Processes the data to extract musical characteristics
 * - Returns optimized animation parameters for the rigged model
 * - Supports different animation blending modes
 * - Caches animation states for smooth transitions
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { spotifyId, fftData, animationParams } = parsed.data;

  console.log(`[MESHY ANIMATE] Processing FFT data for track: ${spotifyId}`);
  console.log(`[MESHY ANIMATE] FFT data:`, fftData);
  console.log(`[MESHY ANIMATE] Animation params:`, animationParams);

  try {
    // Get cached rigging information for this track
    const riggingInfo = cacheGet(`meshy:rig:${spotifyId}`);

    if (!riggingInfo) {
      console.log(
        `[MESHY ANIMATE] No rigging info found for track: ${spotifyId}`
      );
      return NextResponse.json(
        {
          error: "No rigging information found. Generate a rigged model first.",
        },
        { status: 404 }
      );
    }

    // Process FFT data to extract musical characteristics
    const processedData = processFFTData(fftData, riggingInfo);

    // Generate animation parameters based on FFT data and rigging style
    const animationOutput = generateAnimationParameters(
      processedData,
      riggingInfo,
      animationParams
    );

    // Cache the current animation state for smooth transitions
    const animationStateKey = `meshy:animation:${spotifyId}:${Math.floor(
      Date.now() / 1000
    )}`;
    cacheSet(
      animationStateKey,
      {
        fftData: processedData,
        animationParams: animationOutput,
        timestamp: Date.now(),
      },
      5000
    ); // Cache for 5 seconds

    console.log(
      `[MESHY ANIMATE] Generated animation parameters:`,
      animationOutput
    );

    return NextResponse.json({
      success: true,
      animationParams: animationOutput,
      processedFFT: processedData,
      riggingInfo: {
        animationType: riggingInfo.animationType,
        riggingStyle: riggingInfo.riggingStyle,
      },
    });
  } catch (e: unknown) {
    console.error(`[MESHY ANIMATE] Error processing animation:`, e);
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * Process FFT data to extract musical characteristics
 */
function processFFTData(fftData: any, riggingInfo: any) {
  const { low, mid, high, energy } = fftData;

  // Normalize FFT values to 0-1 range
  const normalizedLow = low / 255;
  const normalizedMid = mid / 255;
  const normalizedHigh = high / 255;

  // Calculate frequency distribution
  const totalEnergy = normalizedLow + normalizedMid + normalizedHigh;
  const lowRatio = totalEnergy > 0 ? normalizedLow / totalEnergy : 0.33;
  const midRatio = totalEnergy > 0 ? normalizedMid / totalEnergy : 0.33;
  const highRatio = totalEnergy > 0 ? normalizedHigh / totalEnergy : 0.33;

  // Detect musical patterns
  const isBassHeavy = lowRatio > 0.5;
  const isMidHeavy = midRatio > 0.5;
  const isTrebleHeavy = highRatio > 0.5;
  const isBalanced =
    Math.abs(lowRatio - midRatio) < 0.1 && Math.abs(midRatio - highRatio) < 0.1;

  // Calculate rhythm intensity
  const rhythmIntensity = Math.sqrt(normalizedLow * normalizedMid);

  // Calculate melodic complexity
  const melodicComplexity =
    Math.abs(normalizedMid - normalizedHigh) +
    Math.abs(normalizedLow - normalizedMid);

  return {
    normalized: {
      low: normalizedLow,
      mid: normalizedMid,
      high: normalizedHigh,
    },
    ratios: { low: lowRatio, mid: midRatio, high: highRatio },
    patterns: { isBassHeavy, isMidHeavy, isTrebleHeavy, isBalanced },
    characteristics: { rhythmIntensity, melodicComplexity, energy },
    raw: fftData,
  };
}

/**
 * Generate animation parameters based on processed FFT data and rigging info
 */
function generateAnimationParameters(
  processedData: any,
  riggingInfo: any,
  animationParams?: any
) {
  const { animationType, riggingStyle } = riggingInfo;
  const { normalized, patterns, characteristics } = processedData;

  // Base animation parameters
  const baseParams = {
    // Bone rotation multipliers
    boneRotation: {
      x: 0,
      y: 0,
      z: 0,
    },
    // Bone scaling multipliers
    boneScale: {
      x: 1,
      y: 1,
      z: 1,
    },
    // Bone position offsets
    bonePosition: {
      x: 0,
      y: 0,
      z: 0,
    },
    // Animation speed and intensity
    speed: 1.0,
    intensity: 1.0,
    // Blending parameters
    blendWeight: 1.0,
    blendMode: animationParams?.blendMode || "additive",
  };

  // Apply animation type-specific logic
  switch (animationType) {
    case "dance":
      return generateDanceAnimation(processedData, baseParams, riggingStyle);
    case "pulse":
      return generatePulseAnimation(processedData, baseParams, riggingStyle);
    case "wave":
      return generateWaveAnimation(processedData, baseParams, riggingStyle);
    case "bounce":
      return generateBounceAnimation(processedData, baseParams, riggingStyle);
    case "spin":
      return generateSpinAnimation(processedData, baseParams, riggingStyle);
    default:
      return generateDefaultAnimation(processedData, baseParams, riggingStyle);
  }
}

/**
 * Generate dance animation parameters
 */
function generateDanceAnimation(
  processedData: any,
  baseParams: any,
  riggingStyle: string
) {
  const { normalized, characteristics } = processedData;
  const { rhythmIntensity, energy } = characteristics;

  // Dance animation focuses on rhythmic movement
  const danceIntensity = rhythmIntensity * energy;

  return {
    ...baseParams,
    boneRotation: {
      x:
        Math.sin(Date.now() * 0.001 * (1 + danceIntensity)) *
        0.2 *
        danceIntensity,
      y:
        Math.cos(Date.now() * 0.001 * (1.5 + danceIntensity)) *
        0.3 *
        danceIntensity,
      z:
        Math.sin(Date.now() * 0.001 * (0.8 + danceIntensity)) *
        0.15 *
        danceIntensity,
    },
    boneScale: {
      x: 1 + Math.sin(Date.now() * 0.002) * 0.1 * danceIntensity,
      y: 1 + Math.cos(Date.now() * 0.002) * 0.1 * danceIntensity,
      z: 1 + Math.sin(Date.now() * 0.002) * 0.1 * danceIntensity,
    },
    speed: 1 + danceIntensity * 0.5,
    intensity: danceIntensity,
    blendMode: "additive",
  };
}

/**
 * Generate pulse animation parameters
 */
function generatePulseAnimation(
  processedData: any,
  baseParams: any,
  riggingStyle: string
) {
  const { normalized, characteristics } = processedData;
  const { energy } = characteristics;

  // Pulse animation focuses on scaling based on energy
  const pulseIntensity = energy * 0.5;

  return {
    ...baseParams,
    boneScale: {
      x: 1 + Math.sin(Date.now() * 0.003) * pulseIntensity,
      y: 1 + Math.sin(Date.now() * 0.003) * pulseIntensity,
      z: 1 + Math.sin(Date.now() * 0.003) * pulseIntensity,
    },
    speed: 1 + energy * 0.3,
    intensity: pulseIntensity,
    blendMode: "multiply",
  };
}

/**
 * Generate wave animation parameters
 */
function generateWaveAnimation(
  processedData: any,
  baseParams: any,
  riggingStyle: string
) {
  const { normalized, characteristics } = processedData;
  const { melodicComplexity, energy } = characteristics;

  // Wave animation focuses on flowing movement
  const waveIntensity = melodicComplexity * energy;

  return {
    ...baseParams,
    bonePosition: {
      x:
        Math.sin(Date.now() * 0.001 * (1 + waveIntensity)) *
        0.1 *
        waveIntensity,
      y:
        Math.cos(Date.now() * 0.001 * (1.2 + waveIntensity)) *
        0.15 *
        waveIntensity,
      z:
        Math.sin(Date.now() * 0.001 * (0.9 + waveIntensity)) *
        0.08 *
        waveIntensity,
    },
    speed: 1 + waveIntensity * 0.4,
    intensity: waveIntensity,
    blendMode: "additive",
  };
}

/**
 * Generate bounce animation parameters
 */
function generateBounceAnimation(
  processedData: any,
  baseParams: any,
  riggingStyle: string
) {
  const { normalized, characteristics } = processedData;
  const { rhythmIntensity, energy } = characteristics;

  // Bounce animation focuses on vertical movement
  const bounceIntensity = rhythmIntensity * energy;

  return {
    ...baseParams,
    bonePosition: {
      x: 0,
      y:
        Math.abs(Math.sin(Date.now() * 0.002 * (1 + bounceIntensity))) *
        0.2 *
        bounceIntensity,
      z: 0,
    },
    speed: 1 + bounceIntensity * 0.6,
    intensity: bounceIntensity,
    blendMode: "replace",
  };
}

/**
 * Generate spin animation parameters
 */
function generateSpinAnimation(
  processedData: any,
  baseParams: any,
  riggingStyle: string
) {
  const { normalized, characteristics } = processedData;
  const { energy } = characteristics;

  // Spin animation focuses on rotation
  const spinIntensity = energy * 0.8;

  return {
    ...baseParams,
    boneRotation: {
      x: 0,
      y: (Date.now() * 0.001 * (1 + spinIntensity)) % (Math.PI * 2),
      z: 0,
    },
    speed: 1 + spinIntensity * 0.4,
    intensity: spinIntensity,
    blendMode: "replace",
  };
}

/**
 * Generate default animation parameters
 */
function generateDefaultAnimation(
  processedData: any,
  baseParams: any,
  riggingStyle: string
) {
  const { characteristics } = processedData;
  const { energy } = characteristics;

  // Default animation combines multiple effects
  return {
    ...baseParams,
    boneRotation: {
      x: Math.sin(Date.now() * 0.001) * 0.1 * energy,
      y: Math.cos(Date.now() * 0.001) * 0.1 * energy,
      z: Math.sin(Date.now() * 0.001) * 0.05 * energy,
    },
    boneScale: {
      x: 1 + Math.sin(Date.now() * 0.0015) * 0.05 * energy,
      y: 1 + Math.cos(Date.now() * 0.0015) * 0.05 * energy,
      z: 1 + Math.sin(Date.now() * 0.0015) * 0.05 * energy,
    },
    speed: 1 + energy * 0.2,
    intensity: energy,
    blendMode: "additive",
  };
}
