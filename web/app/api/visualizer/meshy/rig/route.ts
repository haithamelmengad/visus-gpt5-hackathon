import { NextResponse } from "next/server";
import { z } from "zod";
import { cacheGetOrSet, cacheSet } from "@/lib/cache";

const inputSchema = z.object({
  prompt: z.string().min(8),
  spotifyId: z.string().min(1),
  animationType: z
    .enum(["dance", "pulse", "wave", "bounce", "spin"])
    .optional()
    .default("dance"),
  riggingStyle: z
    .enum(["humanoid", "creature", "object", "abstract"])
    .optional()
    .default("object"),
  musicFeatures: z
    .object({
      tempo: z.number().optional(),
      energy: z.number().optional(),
      valence: z.number().optional(),
      danceability: z.number().optional(),
    })
    .optional(),
});

/**
 * Meshy Rigging and Animation API
 *
 * This endpoint generates animated 3D models with rigging that can be controlled
 * by music FFT data for real-time animation in the visualizer.
 *
 * The generated models include:
 * - Rigged skeletons for animation
 * - Pre-defined animation clips
 * - Music-reactive animation parameters
 * - Optimized for real-time FFT-driven animation
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { prompt, spotifyId, animationType, riggingStyle, musicFeatures } =
    parsed.data;
  const apiKey = process.env.MESHY_API_KEY;

  console.log(
    `[MESHY RIG] Starting rigged animation generation for track: ${spotifyId}`
  );
  console.log(`[MESHY RIG] Prompt: "${prompt}"`);
  console.log(`[MESHY RIG] Animation type: ${animationType}`);
  console.log(`[MESHY RIG] Rigging style: ${riggingStyle}`);

  if (!apiKey) {
    console.log(
      `[MESHY RIG] Error: Missing MESHY_API_KEY environment variable`
    );
    return NextResponse.json(
      { error: "Missing MESHY_API_KEY" },
      { status: 500 }
    );
  }

  try {
    console.log(
      `[MESHY RIG] Calling Meshy rigging API with key: ${apiKey.substring(
        0,
        8
      )}...`
    );

    // Create a cache key that includes animation and rigging parameters
    const cacheKey = `meshy:rig:${spotifyId}:${animationType}:${riggingStyle}`;
    const ttlMs = parseInt(process.env.MESHY_RIG_CACHE_TTL_MS || "600000", 10); // 10 min default

    // Enhanced prompt for rigging and animation
    const enhancedPrompt = `${prompt}, ${riggingStyle} rigging, ${animationType} animation, music-reactive, optimized for real-time animation`;

    // Parameters for Meshy rigging API
    const rigParams = {
      mode: "rigged", // Special mode for rigged models
      prompt: enhancedPrompt,
      topology: "triangle",
      enable_pbr: true,
      enable_rigging: true,
      enable_animation: true,
      animation_type: animationType,
      rigging_style: riggingStyle,
      // Music-specific parameters
      music_features: musicFeatures
        ? {
            tempo: musicFeatures.tempo || 120,
            energy: musicFeatures.energy || 0.5,
            valence: musicFeatures.valence || 0.5,
            danceability: musicFeatures.danceability || 0.5,
          }
        : undefined,
      // Animation parameters
      animation_params: {
        frame_rate: 30,
        duration: 10, // 10 second loop
        loop: true,
        keyframes: generateKeyframes(animationType, musicFeatures),
      },
      // Rigging parameters
      rigging_params: {
        bone_count: getBoneCount(riggingStyle),
        joint_types: getJointTypes(riggingStyle),
        ik_chains: getIKChains(riggingStyle),
      },
    };

    // Remove undefined values to avoid API issues
    Object.keys(rigParams).forEach((key) => {
      if (rigParams[key as keyof typeof rigParams] === undefined) {
        delete rigParams[key as keyof typeof rigParams];
      }
    });

    console.log(
      `[MESHY RIG] Rigging API parameters:`,
      JSON.stringify(rigParams, null, 2)
    );

    const { status, json } = await cacheGetOrSet<{
      status: number;
      json: Record<string, unknown>;
    }>(cacheKey, ttlMs, async () => {
      const res = await fetch("https://api.meshy.ai/v2/text-to-3d", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(rigParams),
      });
      const json = await res.json();
      return { status: res.status, json };
    });

    console.log(`[MESHY RIG] Meshy API response status: ${status}`);
    console.log(
      `[MESHY RIG] Meshy API response:`,
      JSON.stringify(json, null, 2)
    );

    if (status < 200 || status >= 300) {
      return NextResponse.json(json, { status });
    }

    // Normalize Meshy response to always return { id } for client polling
    const jsonObj = json as Record<string, unknown>;
    let idCandidate =
      (jsonObj && (jsonObj.id || jsonObj.task_id || jsonObj.generation_id)) ||
      (jsonObj?.result &&
        typeof jsonObj.result === "object" &&
        jsonObj.result &&
        ((jsonObj.result as Record<string, unknown>).id ||
          (jsonObj.result as Record<string, unknown>).task_id)) ||
      (jsonObj?.data &&
        typeof jsonObj.data === "object" &&
        jsonObj.data &&
        ((jsonObj.data as Record<string, unknown>).id ||
          (jsonObj.data as Record<string, unknown>).task_id));

    // Meshy sometimes returns { result: "<generation-id>" }
    if (!idCandidate && typeof jsonObj?.result === "string") {
      idCandidate = jsonObj.result;
    }

    if (typeof idCandidate === "string" && idCandidate.trim().length > 0) {
      console.log(
        `[MESHY RIG] Normalized rigging generation ID: ${idCandidate}`
      );

      // Cache the rigging generation ID for future reference
      cacheSet(
        `meshy:rig:${spotifyId}`,
        {
          id: idCandidate,
          animationType,
          riggingStyle,
          musicFeatures,
          timestamp: Date.now(),
        },
        parseInt(process.env.MESHY_RIG_CACHE_TTL_MS || "86400000", 10) // 24h default
      );

      return NextResponse.json({
        id: idCandidate,
        mode: "rigged",
        animationType,
        riggingStyle,
        musicFeatures,
        spotifyId,
      });
    }

    // If we cannot find an id, return a 502 with the raw for debugging
    console.log(
      `[MESHY RIG] Could not find rigging generation id in response.`
    );
    return NextResponse.json(
      { error: "missing_id", raw: json },
      { status: 502 }
    );
  } catch (e: unknown) {
    console.error(`[MESHY RIG] Error during rigging generation:`, e);
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Unknown" },
      { status: 500 }
    );
  }
}

/**
 * Generate animation keyframes based on animation type and music features
 */
function generateKeyframes(animationType: string, musicFeatures?: any) {
  const baseKeyframes = {
    dance: [
      { time: 0, rotation: { x: 0, y: 0, z: 0 } },
      { time: 2.5, rotation: { x: 0.1, y: 0.2, z: 0.05 } },
      { time: 5, rotation: { x: -0.1, y: 0.4, z: -0.05 } },
      { time: 7.5, rotation: { x: 0.05, y: 0.6, z: 0.1 } },
      { time: 10, rotation: { x: 0, y: 0, z: 0 } },
    ],
    pulse: [
      { time: 0, scale: { x: 1, y: 1, z: 1 } },
      { time: 2.5, scale: { x: 1.2, y: 1.2, z: 1.2 } },
      { time: 5, scale: { x: 0.8, y: 0.8, z: 0.8 } },
      { time: 7.5, scale: { x: 1.1, y: 1.1, z: 1.1 } },
      { time: 10, scale: { x: 1, y: 1, z: 1 } },
    ],
    wave: [
      { time: 0, position: { x: 0, y: 0, z: 0 } },
      { time: 2.5, position: { x: 0.1, y: 0.05, z: 0 } },
      { time: 5, position: { x: -0.1, y: 0.1, z: 0 } },
      { time: 7.5, position: { x: 0.05, y: -0.05, z: 0 } },
      { time: 10, position: { x: 0, y: 0, z: 0 } },
    ],
    bounce: [
      { time: 0, position: { x: 0, y: 0, z: 0 } },
      { time: 2.5, position: { x: 0, y: 0.3, z: 0 } },
      { time: 5, position: { x: 0, y: 0, z: 0 } },
      { time: 7.5, position: { x: 0, y: 0.2, z: 0 } },
      { time: 10, position: { x: 0, y: 0, z: 0 } },
    ],
    spin: [
      { time: 0, rotation: { x: 0, y: 0, z: 0 } },
      { time: 2.5, rotation: { x: 0, y: Math.PI / 2, z: 0 } },
      { time: 5, rotation: { x: 0, y: Math.PI, z: 0 } },
      { time: 7.5, rotation: { x: 0, y: Math.PI * 1.5, z: 0 } },
      { time: 10, rotation: { x: 0, y: Math.PI * 2, z: 0 } },
    ],
  };

  return (
    baseKeyframes[animationType as keyof typeof baseKeyframes] ||
    baseKeyframes.dance
  );
}

/**
 * Get appropriate bone count for different rigging styles
 */
function getBoneCount(riggingStyle: string): number {
  const boneCounts = {
    humanoid: 24, // Standard humanoid skeleton
    creature: 18, // Quadruped or winged creature
    object: 8, // Simple object rigging
    abstract: 12, // Abstract/artistic rigging
  };
  return boneCounts[riggingStyle as keyof typeof boneCounts] || 8;
}

/**
 * Get joint types for different rigging styles
 */
function getJointTypes(riggingStyle: string): string[] {
  const jointTypes = {
    humanoid: ["ball", "hinge", "free"],
    creature: ["ball", "hinge", "free"],
    object: ["free", "hinge"],
    abstract: ["free", "ball"],
  };
  return jointTypes[riggingStyle as keyof typeof jointTypes] || ["free"];
}

/**
 * Get IK chain configuration for different rigging styles
 */
function getIKChains(riggingStyle: string): any[] {
  const ikChains = {
    humanoid: [
      { name: "left_arm", start: "left_shoulder", end: "left_wrist" },
      { name: "right_arm", start: "right_shoulder", end: "right_wrist" },
      { name: "left_leg", start: "left_hip", end: "left_foot" },
      { name: "right_leg", start: "right_hip", end: "right_foot" },
    ],
    creature: [
      { name: "front_legs", start: "spine_1", end: "front_feet" },
      { name: "back_legs", start: "spine_3", end: "back_feet" },
    ],
    object: [{ name: "main", start: "root", end: "tip" }],
    abstract: [
      { name: "primary", start: "base", end: "end" },
      { name: "secondary", start: "mid", end: "tip" },
    ],
  };
  return ikChains[riggingStyle as keyof typeof ikChains] || [];
}
