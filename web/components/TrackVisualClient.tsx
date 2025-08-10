"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import TrackPlayer from "@/components/TrackPlayer";
import type { VisualizerRecipe } from "@/types/visualizer";

type Props = {
  // Basic display fields
  title: string;
  artistNames: string;
  albumImageUrl?: string;
  previewUrl?: string | null;
  spotifyUrl?: string;
  // Required to fetch full recipe & features
  spotifyId?: string;
};

type SpotifyFeatures = Record<string, number | string | null | undefined>;

// Function to extract dominant colors from an image
const extractDominantColors = async (
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

export default function TrackVisualClient(props: Props) {
  // Audio/preview state
  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState<string | null>(
    props.previewUrl ?? null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  // analyser/FFT are kept in refs to avoid rerenders
  // Keep latest analyser/FFT in refs so the render effect does not re-init
  const analyserLatestRef = useRef<AnalyserNode | null>(null);
  const fftLatestRef = useRef<Uint8Array | null>(null);

  // Data state
  const [features, setFeatures] = useState<SpotifyFeatures | null>(null);
  const [recipe, setRecipe] = useState<VisualizerRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meshyStatus, setMeshyStatus] = useState<string | null>(null);
  const [meshyPrompt, setMeshyPrompt] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "analyzing" | "thinking" | "visualizing" | "creating"
  >("analyzing");

  // Three.js refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  // No fallback primitive; we show loading until the Meshy model is ready
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const frameRef = useRef<number | null>(null);
  const gltfLoaderRef = useRef<GLTFLoader | null>(null);
  // Holds the single model that we render; we add/remove children inside this group
  const currentObjectRef = useRef<THREE.Group | null>(null);
  const modelLoadInProgressRef = useRef<boolean>(false);
  const [modelReady, setModelReady] = useState(false);
  const baseScaleRef = useRef<number>(1);
  const isPlayingRef = useRef<boolean>(false);
  const lastTickTimeRef = useRef<number>(0);
  const tempoRef = useRef<number>(120);

  // Keep latest tempo (BPM) available for the render loop
  useEffect(() => {
    const tempo = Number((features as unknown as { tempo?: number })?.tempo);
    if (!Number.isNaN(tempo) && tempo > 0) {
      tempoRef.current = tempo;
    } else {
      tempoRef.current = 120; // sensible default
    }
  }, [features]);

  // Smoothing refs for FFT data to reduce spiky distortion
  const lastLowRef = useRef<number>(0);
  const lastMidRef = useRef<number>(0);
  const lastHighRef = useRef<number>(0);
  const lastEnergyRef = useRef<number>(0);

  // Store dominant colors from album cover
  const [dominantColors, setDominantColors] = useState<THREE.Color[]>([]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Extract dominant colors from album cover when available
  useEffect(() => {
    if (props.albumImageUrl) {
      extractDominantColors(props.albumImageUrl).then(setDominantColors);
    }
  }, [props.albumImageUrl]);

  // Fetch full recipe
  useEffect(() => {
    const id = props.spotifyId;
    if (!id) return;
    let aborted = false;
    const run = async () => {
      try {
        const r = await fetch(`/api/visualizer/recipe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spotifyId: id,
            title: props.title,
            artist: props.artistNames,
            includeAnalysis: false,
            skipEnrichment: true,
          }),
        });
        if (!r.ok) throw new Error(await r.text());
        const data = (await r.json()) as VisualizerRecipe;
        if (!aborted) {
          setRecipe(data);
          setPhase("thinking");
          // Use seed as provisional idea text until Meshy prompt is available
          const seed = (data?.seed || data?.concept || "").toString();
          if (seed) setMeshyPrompt(seed);
        }
      } catch (e) {
        if (!aborted)
          setError(e instanceof Error ? e.message : "Failed to get recipe");
      }
    };
    run();
    return () => {
      aborted = true;
    };
  }, [props.spotifyId, props.title, props.artistNames]);

  // Fetch Spotify audio features (tempo used for rotation speed)
  useEffect(() => {
    const id = props.spotifyId;
    if (!id) return;
    let aborted = false;
    const run = async () => {
      try {
        const r = await fetch(`/api/spotify/features/${id}`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(await r.text());
        const data = (await r.json()) as SpotifyFeatures;
        if (!aborted) setFeatures(data);
      } catch {
        if (!aborted) setFeatures(null);
      }
    };
    run();
    return () => {
      aborted = true;
    };
  }, [props.spotifyId]);

  // Compute a simple scalar from Spotify features using recipe-provided weights
  const spotifyScalar = useMemo(() => {
    const weights = recipe?.audioMapping.spotifyWeights ?? {};
    const entries = Object.entries(weights) as Array<
      [keyof SpotifyFeatures, number]
    >;
    const weighted = entries.reduce((acc, [k, w]) => {
      const base = features?.[k];
      const v = typeof base === "number" ? base : 0;
      return acc + v * w;
    }, 0 as number);
    return weighted;
  }, [features, recipe]);

  // Receive analyser from the TrackPlayer to avoid duplicate audio contexts
  const handleAnalyserReady = (node: AnalyserNode) => {
    try {
      const arr = new Uint8Array(node.frequencyBinCount);
      analyserLatestRef.current = node;
      fftLatestRef.current = arr;
    } catch {}
  };

  // Client-side fallback to resolve preview URL if SSR missed it
  useEffect(() => {
    if (resolvedPreviewUrl) return;
    let aborted = false;
    const run = async () => {
      try {
        const r = await fetch(
          `/api/preview?title=${encodeURIComponent(
            props.title
          )}&artist=${encodeURIComponent(props.artistNames)}&limit=1`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const data = await r.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        const first = results[0] ?? {};
        const urls: string[] = Array.isArray(first?.previewUrls)
          ? first.previewUrls
          : [];
        if (!aborted && urls.length > 0) setResolvedPreviewUrl(urls[0]);
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      aborted = true;
    };
  }, [resolvedPreviewUrl, props.title, props.artistNames]);

  // Initialize and render the shader-based visualizer using the full recipe
  useEffect(() => {
    if (!recipe) return;
    const container = containerRef.current;
    if (!container) return;

    // Setup scene and renderer
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    const scene = new THREE.Scene();
    // Remove background color to let the CSS gradient show through
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 100);
    camera.position.set(0, 0, 4.5);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas: canvasRef.current ?? undefined,
      alpha: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4; // Increased for better color vibrancy
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;
    if (!canvasRef.current) {
      container.appendChild(renderer.domElement);
      canvasRef.current = renderer.domElement;
    }

    // Enhanced lighting for better color vibrancy and contrast
    const enhancedDirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    enhancedDirLight.position.set(8, 12, 8);
    enhancedDirLight.castShadow = true;
    enhancedDirLight.shadow.mapSize.width = 2048;
    enhancedDirLight.shadow.mapSize.height = 2048;
    enhancedDirLight.shadow.camera.near = 0.5;
    enhancedDirLight.shadow.camera.far = 50;

    const enhancedAmb = new THREE.AmbientLight(0xffffff, 0.8);
    const rimLight = new THREE.DirectionalLight(0x4a90e2, 1.2); // Blue rim light for contrast
    rimLight.position.set(-5, 3, -5);
    const fillLight = new THREE.DirectionalLight(0xffd700, 0.6); // Warm fill light
    fillLight.position.set(3, 2, 3);

    (
      enhancedDirLight as THREE.DirectionalLight & { isLight?: boolean }
    ).isLight = true;
    (enhancedAmb as THREE.AmbientLight & { isLight?: boolean }).isLight = true;
    (rimLight as THREE.DirectionalLight & { isLight?: boolean }).isLight = true;
    (fillLight as THREE.DirectionalLight & { isLight?: boolean }).isLight =
      true;

    scene.add(enhancedAmb);
    scene.add(enhancedDirLight);
    scene.add(rimLight);
    scene.add(fillLight);

    // Create a dedicated group that will contain exactly one loaded model
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    currentObjectRef.current = modelGroup;

    // No fallback primitive geometry; we wait for Meshy model

    // material (simple displacement shader driven by amplitude)
    const pickPrimary = (palette?: string[]): string => {
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
    const primaryHex = pickPrimary(recipe.colorPalette);
    const clean = primaryHex.startsWith("#") ? primaryHex.slice(1) : primaryHex;
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;

    // Defer adding any geometry until Meshy model is ready

    // If GPT selected a custom metaphor, try to replace the fallback primitive with a Meshy-generated model
    // Function to apply color alteration and display a 3D model
    const applyColorAlterationAndDisplay = async (
      gltf: GLTF,
      modelType: "preview" | "refined"
    ) => {
      try {
        console.log(
          `[CLIENT] 🎨 Applying color alteration to ${modelType} model...`
        );

        const root: THREE.Group =
          (gltf.scene as THREE.Group) || (gltf.scenes?.[0] as THREE.Group);
        if (!root) return;

        // Ensure only one model: clear the model group entirely before adding
        try {
          const group = currentObjectRef.current as THREE.Group;
          const children = [...group.children];
          for (const child of children) {
            group.remove(child);
            child.traverse((node: THREE.Object3D) => {
              const meshNode = node as THREE.Object3D & { isMesh?: boolean };
              if (meshNode.isMesh) {
                const realMesh = meshNode as unknown as THREE.Mesh;
                realMesh.geometry?.dispose?.();
                const mat = realMesh.material as
                  | THREE.Material
                  | THREE.Material[]
                  | undefined;
                if (Array.isArray(mat)) mat.forEach((mm) => mm?.dispose?.());
                else mat?.dispose?.();
              }
            });
          }
        } catch {}

        // Fit and center
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        root.position.sub(center);

        // Scale to a comfortable on-screen size
        const desiredMaxSize = 2.6;
        const currentMaxSize = Math.max(1e-3, Math.max(size.x, size.y, size.z));
        const scalar = desiredMaxSize / currentMaxSize;
        root.scale.multiplyScalar(scalar);
        baseScaleRef.current = root.scale.x;

        // Apply color alteration based on album cover dominant color
        root.traverse((obj: THREE.Object3D) => {
          if (obj instanceof THREE.Mesh) {
            const originalMaterial = obj.material;
            console.log(
              `[DEBUG] Processing ${modelType} mesh with material:`,
              originalMaterial?.type
            );

            // Enhanced material enhancement system
            const hasValidColor = (mat: THREE.Material): boolean => {
              const m = mat as THREE.Material & {
                color?: THREE.Color;
                map?: THREE.Texture;
              };
              if (m.map) return true; // Has texture
              if (m.color) {
                const c = m.color;
                return c.r > 0 || c.g > 0 || c.b > 0; // Has non-black color
              }
              return false;
            };

            const enhanceMaterial = (
              material: THREE.Material,
              meshName: string
            ): THREE.Material => {
              const enhanced = material.clone();

              if (!hasValidColor(enhanced)) {
                console.log(
                  `[DEBUG] ${modelType} material lacks proper colors, enhancing with album cover colors...`
                );

                // Use album cover dominant colors if available, otherwise fallback to song-aware colors
                const getBaseColor = (): THREE.Color => {
                  if (dominantColors.length > 0) {
                    // Use the most dominant color from album cover
                    const primaryColor = dominantColors[0];
                    console.log(
                      `[DEBUG] Using album cover dominant color:`,
                      primaryColor
                    );
                    return primaryColor;
                  } else {
                    // Fallback to song-aware colors
                    const seed = `${props.title}${props.artistNames}`;
                    let hash = 0;
                    for (let i = 0; i < seed.length; i++) {
                      hash =
                        ((hash << 5) - hash + seed.charCodeAt(i)) & 0xffffffff;
                    }
                    const hue = (hash % 360) / 360;
                    const saturation = 0.6 + ((hash >> 8) % 40) / 100;
                    const lightness = 0.4 + ((hash >> 16) % 30) / 100;
                    return new THREE.Color().setHSL(hue, saturation, lightness);
                  }
                };

                const generateComplementaryColors = (
                  baseColor: THREE.Color
                ): THREE.Color[] => {
                  const hsl = { h: 0, s: 0, l: 0 };
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

                const baseColor = getBaseColor();
                const complementaryColors =
                  generateComplementaryColors(baseColor);

                if (enhanced instanceof THREE.MeshStandardMaterial) {
                  enhanced.color = baseColor;
                  enhanced.emissive = complementaryColors[0]
                    .clone()
                    .multiplyScalar(0.1);
                  enhanced.emissiveIntensity = 0.2;

                  const titleHash = props.title
                    .split("")
                    .reduce((a, b) => a + b.charCodeAt(0), 0);
                  enhanced.metalness = 0.1 + (titleHash % 60) / 100;
                  enhanced.roughness = 0.2 + (titleHash % 50) / 100;
                  enhanced.vertexColors = true;

                  // Create vertex colors for subtle variation
                  if (
                    obj instanceof THREE.Mesh &&
                    obj.geometry.attributes.position
                  ) {
                    const positions = obj.geometry.attributes.position.array;
                    const colors = new Float32Array(positions.length);

                    for (let i = 0; i < positions.length; i += 3) {
                      const x = positions[i];
                      const y = positions[i + 1];
                      const z = positions[i + 2];
                      const noise =
                        Math.sin(x * 2) * Math.cos(y * 3) * Math.sin(z * 4);
                      const colorVariation = 0.1;

                      colors[i] = baseColor.r + noise * colorVariation;
                      colors[i + 1] = baseColor.g + noise * colorVariation;
                      colors[i + 2] = baseColor.b + noise * colorVariation;
                    }

                    obj.geometry.setAttribute(
                      "color",
                      new THREE.BufferAttribute(colors, 3)
                    );
                  }
                }
              }

              return enhanced;
            };

            if (Array.isArray(originalMaterial)) {
              obj.material = originalMaterial.map((mat, index) =>
                enhanceMaterial(mat, `${obj.name || "unknown"}_${index}`)
              );
            } else if (originalMaterial) {
              obj.material = enhanceMaterial(
                originalMaterial,
                obj.name || "unknown"
              );
            }
          }
        });

        // Add the enhanced model to the scene
        if (currentObjectRef.current) {
          currentObjectRef.current.add(root);
          setModelReady(true);
          console.log(
            `[CLIENT] ✅ ${modelType.toUpperCase()} model added to scene with color alteration!`
          );
        }
      } catch (error) {
        console.error(
          `[CLIENT] Error applying color alteration to ${modelType} model:`,
          error
        );
      }
    };

    // Function to load and display a 3D model with color alteration
    const loadAndDisplayModel = async (
      modelUrl: string,
      modelType: "preview" | "refined"
    ) => {
      try {
        console.log(`[CLIENT] 🎨 Loading ${modelType} model: ${modelUrl}`);

        if (!gltfLoaderRef.current) gltfLoaderRef.current = new GLTFLoader();
        const proxiedUrl = `/api/visualizer/meshy/fetch?url=${encodeURIComponent(
          modelUrl
        )}`;
        console.log(`[CLIENT] Proxied URL for loading: ${proxiedUrl}`);

        // Always dispose and replace the loader to avoid parallel loads
        try {
          const anyLoader = gltfLoaderRef.current as unknown as {
            manager?: { itemEnd?: (u: string) => void };
          };
          anyLoader.manager?.itemEnd?.(proxiedUrl);
        } catch {}
        gltfLoaderRef.current = new GLTFLoader();

        setPhase("creating");
        setMeshyStatus(`loading ${modelType} 3D model...`);

        console.log(`[CLIENT] Starting GLTF load for ${modelType} model...`);
        const gltf = await new Promise<GLTF>((resolve, reject) => {
          gltfLoaderRef.current!.load(proxiedUrl, resolve, undefined, reject);
        });

        console.log(`[DEBUG] GLTF loaded for ${modelType}:`, gltf);
        console.log(`[DEBUG] GLTF scene:`, gltf.scene);
        console.log(
          `[DEBUG] GLTF scene children count:`,
          gltf.scene.children.length
        );

        // Apply color alteration and display the model
        await applyColorAlterationAndDisplay(gltf, modelType);

        console.log(
          `[CLIENT] ✅ ${modelType.toUpperCase()} model loaded and displayed successfully!`
        );
      } catch (error) {
        console.error(`[CLIENT] Error loading ${modelType} model:`, error);
        setMeshyStatus(`error loading ${modelType} model`);
      }
    };

    const tryLoadMeshyModel = async () => {
      try {
        if (!props.spotifyId) return;
        if (modelLoadInProgressRef.current) return;
        modelLoadInProgressRef.current = true;
        // Allow runtime opt-out via env flag; if not set, still proceed by default
        const enable =
          (process.env.NEXT_PUBLIC_ENABLE_MESHY ?? "true").toLowerCase() !==
          "false";
        if (!enable) return;

        console.log(
          `[CLIENT] Requesting Meshy prompt/model for track ID: ${props.spotifyId}`
        );

        // First ask for cached modelUrl/prompt
        const promptRes = await fetch(`/api/visualizer/meshy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spotifyId: props.spotifyId,
            includeAnalysis: false,
          }),
        });

        if (!promptRes.ok) {
          console.log(`[CLIENT] Meshy prompt error: ${promptRes.status}`);
          setMeshyStatus(`meshy prompt error: ${promptRes.status}`);
          return;
        }

        const promptJson = (await promptRes.json()) as {
          prompt?: string;
          modelUrl?: string;
        };
        let modelUrl: string | null = null;
        let previewModelUrl: string | null = null;

        // Always go through the two-stage workflow for better quality
        // Even if we have a cached model, we'll try to refine it
        if (promptJson.modelUrl) {
          console.log(
            `[CLIENT] Found cached model URL, but proceeding with preview+refine workflow for better quality: ${promptJson.modelUrl}`
          );
          console.log(
            `[CLIENT] Storing cached URL as fallback: ${promptJson.modelUrl}`
          );
          // Store the cached URL as a potential fallback
          previewModelUrl = promptJson.modelUrl;
        } else {
          console.log(
            `[CLIENT] No cached model URL found, will generate from scratch`
          );
        }

        if (promptJson.prompt) setMeshyPrompt(promptJson.prompt);

        let startJson: { id?: string; mode?: string; previewId?: string } = {};
        let previewGenerationId: string | null = null;

        // Always start the preview generation workflow
        if (!promptJson.prompt) return;
        const prompt = promptJson.prompt;
        console.log(
          `[CLIENT] Starting Meshy 3D generation with prompt: "${prompt}"`
        );

        // Step 1: Start preview generation
        console.log(`[CLIENT] Step 1: Starting PREVIEW generation...`);
        const startRes = await fetch(`/api/visualizer/meshy/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, mode: "preview" }),
        });

        if (!startRes.ok) {
          const txt = await startRes.text();
          console.log(
            `[CLIENT] Meshy preview start error: ${startRes.status} - ${txt}`
          );
          setMeshyStatus(`meshy preview start error: ${startRes.status}`);
          console.warn("meshy preview start error", txt);
          return;
        }

        startJson = (await startRes.json()) as { id?: string; mode?: string };
        console.log(
          `[CLIENT] Meshy PREVIEW generation started with ID: ${startJson.id}, mode: ${startJson.mode}`
        );
        if (!startJson.id) {
          console.log(`[CLIENT] No preview generation ID returned, exiting`);
          return;
        }
        previewGenerationId = startJson.id;
        console.log(
          `[CLIENT] Set previewGenerationId to: ${previewGenerationId}`
        );
        setPhase("visualizing");

        type MeshyAsset = {
          url?: string;
          format?: string;
          type?: string;
          mimeType?: string;
        };
        type MeshyStatus = {
          status?: string;
          model_url?: string;
          modelUrl?: string;
          model_urls?: {
            glb?: string;
            GLB?: string;
            gltf?: string;
            GLTF?: string;
            mtl?: string;
            MTL?: string;
          } | null;
          modelUrls?: {
            glb?: string;
            GLB?: string;
            gltf?: string;
            GLTF?: string;
            mtl?: string;
            MTL?: string;
          } | null;
          assets?: MeshyAsset[] | null;
          files?: MeshyAsset[] | null;
        };
        const pickModelUrl = (j: MeshyStatus): string | null => {
          if (typeof j?.model_url === "string") return j.model_url;
          if (typeof j?.modelUrl === "string") return j.modelUrl;

          // Also try to extract MTL URL for color information
          const tryMTLUrl = (obj: unknown): string | null => {
            if (!obj || typeof obj !== "object") return null;
            const o = obj as {
              mtl?: unknown;
              MTL?: unknown;
            };
            const mtl =
              typeof o.mtl === "string"
                ? o.mtl
                : typeof o.MTL === "string"
                ? (o.MTL as string)
                : null;
            return mtl;
          };

          const tryModelUrls = (obj: unknown): string | null => {
            if (!obj || typeof obj !== "object") return null;
            const o = obj as {
              glb?: unknown;
              GLB?: unknown;
              gltf?: unknown;
              GLTF?: unknown;
            };
            const glb =
              typeof o.glb === "string"
                ? o.glb
                : typeof o.GLB === "string"
                ? (o.GLB as string)
                : null;
            const gltf =
              typeof o.gltf === "string"
                ? o.gltf
                : typeof o.GLTF === "string"
                ? (o.GLTF as string)
                : null;
            return glb || gltf || null;
          };
          const direct =
            tryModelUrls(j.model_urls) || tryModelUrls(j.modelUrls);
          if (direct) return direct;
          const fromAssets = (arr: MeshyAsset[]): string | null => {
            for (const a of arr) {
              const url = typeof a?.url === "string" ? a.url : null;
              const format = (a?.format ?? a?.type ?? a?.mimeType ?? "")
                .toString()
                .toLowerCase();
              if (url && (url.endsWith(".glb") || url.endsWith(".gltf")))
                return url;
              if (url && (format.includes("glb") || format.includes("gltf")))
                return url;
            }
            const anyUrl = arr.find((a) => typeof a?.url === "string");
            return anyUrl?.url ?? null;
          };
          if (Array.isArray(j.assets)) {
            const u = fromAssets(j.assets);
            if (u) return u;
          }
          if (Array.isArray(j.files)) {
            const u = fromAssets(j.files);
            if (u) return u;
          }
          return null;
        };
        // Step 2: Poll preview generation status
        console.log(
          `[CLIENT] Step 2: Polling PREVIEW generation status for ID: ${previewGenerationId}`
        );
        for (let i = 0; i < 40; i++) {
          console.log(`[CLIENT] Preview poll attempt ${i + 1}/40`);
          await new Promise((r) => setTimeout(r, 3000));
          const s = await fetch(
            `/api/visualizer/meshy/status?id=${encodeURIComponent(
              previewGenerationId!
            )}`,
            { cache: "no-store" }
          );
          if (!s.ok) {
            console.log(`[CLIENT] Preview status request failed: ${s.status}`);
            continue;
          }
          const j = (await s.json()) as MeshyStatus;
          console.log(`[CLIENT] Preview status response:`, j);
          setMeshyStatus(`meshy preview status: ${j.status ?? "pending"}`);
          const picked = pickModelUrl(j);
          console.log(`[CLIENT] Picked model URL from preview:`, picked);
          if (picked) {
            previewModelUrl = picked;
            console.log(
              `[CLIENT] PREVIEW model URL selected: ${previewModelUrl}`
            );
            console.log(`[CLIENT] Breaking out of preview polling loop`);

            // Immediately display the preview model with color alteration as the visualizer
            console.log(
              `[CLIENT] 🎨 Loading preview model immediately as visualizer with album cover color alteration...`
            );
            await loadAndDisplayModel(previewModelUrl, "preview");

            // Set model ready to true so the preview is displayed immediately
            setModelReady(true);
            setMeshyStatus("preview ready - refining for better quality...");

            break;
          }
          if (j.status && /failed|canceled/i.test(j.status)) {
            console.log(
              `[CLIENT] PREVIEW generation failed or canceled: ${j.status}`
            );
            break;
          }
        }

        console.log(
          `[CLIENT] Preview polling loop completed. previewModelUrl: ${previewModelUrl}`
        );

        if (!previewModelUrl) {
          console.log(
            `[CLIENT] PREVIEW generation did not complete successfully`
          );
          return;
        }

        console.log(`[CLIENT] PREVIEW generation completed successfully!`);
        console.log(`[CLIENT] About to start Step 3: REFINE generation...`);
        console.log(
          `[CLIENT] Current state - previewGenerationId: ${previewGenerationId}, previewModelUrl: ${previewModelUrl}`
        );

        // Step 3: Request refinement using the preview ID
        console.log(
          `[CLIENT] Step 3: Starting REFINE generation using preview ID: ${previewGenerationId}`
        );
        console.log(
          `[CLIENT] Sending refine request to /api/visualizer/meshy/refine`
        );
        console.log(`[CLIENT] Refine request body:`, {
          previewId: previewGenerationId,
          prompt: promptJson.prompt,
          enablePbr: true,
          topology: "triangle",
        });
        setMeshyStatus(`refining 3D model...`);

        const refineRes = await fetch(`/api/visualizer/meshy/refine`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            previewId: previewGenerationId,
            prompt: promptJson.prompt, // Optional: can override prompt for refinement
            enablePbr: true,
            topology: "triangle",
          }),
        });

        console.log(`[CLIENT] Refine response status: ${refineRes.status}`);
        console.log(
          `[CLIENT] Refine response headers:`,
          Object.fromEntries(refineRes.headers.entries())
        );

        if (!refineRes.ok) {
          const txt = await refineRes.text();
          console.log(
            `[CLIENT] Meshy refine error: ${refineRes.status} - ${txt}`
          );
          setMeshyStatus(`meshy refine error: ${refineRes.status}`);
          console.warn("meshy refine error", txt);
          // Fallback to preview model if refinement fails
          console.log(
            `[CLIENT] Falling back to preview model due to refine error`
          );
          modelUrl = previewModelUrl;
        } else {
          const refineJson = (await refineRes.json()) as {
            id?: string;
            mode?: string;
            previewId?: string;
          };
          console.log(`[CLIENT] Refine response JSON:`, refineJson);
          console.log(
            `[CLIENT] Meshy REFINE generation started with ID: ${refineJson.id}, mode: ${refineJson.mode}, previewId: ${refineJson.previewId}`
          );

          if (refineJson.id) {
            // Step 4: Poll refinement status
            console.log(
              `[CLIENT] Step 4: Polling REFINE generation status for ID: ${refineJson.id}`
            );
            for (let i = 0; i < 60; i++) {
              // Longer timeout for refinement
              await new Promise((r) => setTimeout(r, 5000)); // Slower polling for refinement
              const s = await fetch(
                `/api/visualizer/meshy/status?id=${encodeURIComponent(
                  refineJson.id
                )}`,
                { cache: "no-store" }
              );
              if (!s.ok) continue;
              const j = (await s.json()) as MeshyStatus;
              setMeshyStatus(`meshy refine status: ${j.status ?? "pending"}`);
              const picked = pickModelUrl(j);
              if (picked) {
                modelUrl = picked;
                console.log(`[CLIENT] REFINE model URL selected: ${modelUrl}`);
                console.log(
                  `[CLIENT] REFINE generation completed successfully! Replacing preview with high-quality model.`
                );

                // Replace the preview model with the refined one
                console.log(
                  `[CLIENT] 🔄 Replacing preview model with refined model...`
                );
                await loadAndDisplayModel(modelUrl, "refined");

                // Update status to indicate refinement is complete
                setMeshyStatus(
                  "refinement complete - high quality model loaded"
                );

                break;
              }
              if (j.status && /failed|canceled/i.test(j.status)) {
                console.log(
                  `[CLIENT] REFINE generation failed or canceled: ${j.status}`
                );
                break;
              }
            }

            // If refinement didn't complete, fallback to preview
            if (!modelUrl) {
              console.log(
                `[CLIENT] REFINE generation did not complete, falling back to preview model`
              );
              modelUrl = previewModelUrl;
            }
          } else {
            console.log(
              `[CLIENT] REFINE request failed to return ID, falling back to preview model`
            );
            modelUrl = previewModelUrl;
          }
        }

        if (!modelUrl) {
          console.log(
            `[CLIENT] No model URL available after preview and refine attempts`
          );
          return;
        }

        // Determine if this is a refined model or preview fallback
        const isRefinedModel = modelUrl !== previewModelUrl;
        console.log(
          `[CLIENT] Loading ${
            isRefinedModel ? "REFINED" : "PREVIEW"
          } model: ${modelUrl}`
        );
        console.log(
          `[CLIENT] Model type: ${
            isRefinedModel ? "High-quality refined" : "Preview fallback"
          }`
        );

        if (!gltfLoaderRef.current) gltfLoaderRef.current = new GLTFLoader();
        const proxiedUrl = `/api/visualizer/meshy/fetch?url=${encodeURIComponent(
          modelUrl!
        )}`;
        console.log(`[CLIENT] Proxied URL for loading: ${proxiedUrl}`);

        // Always dispose and replace the loader to avoid parallel loads adding twice
        try {
          const anyLoader = gltfLoaderRef.current as unknown as {
            manager?: { itemEnd?: (u: string) => void };
          };
          anyLoader.manager?.itemEnd?.(proxiedUrl);
        } catch {}
        gltfLoaderRef.current = new GLTFLoader();
        setPhase("creating");

        console.log(
          `[CLIENT] Starting GLTF load for ${
            isRefinedModel ? "refined" : "preview"
          } model...`
        );
        const gltf = await new Promise<GLTF>((resolve, reject) => {
          gltfLoaderRef.current!.load(proxiedUrl, resolve, undefined, reject);
        });

        console.log("[DEBUG] GLTF loaded:", gltf);
        console.log("[DEBUG] GLTF scene:", gltf.scene);
        console.log(
          "[DEBUG] GLTF scene children count:",
          gltf.scene.children.length
        );

        // Log the complete workflow summary
        console.log(`[CLIENT] 🎯 MESHY WORKFLOW COMPLETE:`);
        console.log(
          `[CLIENT]   ✅ Preview generation: ${previewGenerationId || "N/A"}`
        );
        console.log(
          `[CLIENT]   ✅ Preview model URL: ${previewModelUrl || "N/A"}`
        );
        console.log(`[CLIENT]   ✅ Final model URL: ${modelUrl || "N/A"}`);
        console.log(
          `[CLIENT]   ✅ Model type: ${
            isRefinedModel ? "REFINED (high-quality)" : "PREVIEW (fallback)"
          }`
        );
        console.log(
          `[CLIENT]   ✅ GLTF loaded successfully with ${gltf.scene.children.length} children`
        );
        console.log(
          `[CLIENT]   🎉 Ready to display ${
            isRefinedModel ? "refined" : "preview"
          } visualizer!`
        );

        // Try to extract colors from MTL file if available
        const tryExtractMTLColors = async (): Promise<Record<
          string,
          THREE.Color
        > | null> => {
          try {
            // Check if we have access to the MTL file URL from the Meshy response
            // This would need to be passed down from the Meshy API response
            const mtlUrl = (window as unknown as Record<string, unknown>)
              .meshyMTLUrl as string | undefined;
            if (!mtlUrl) return null;

            console.log(
              "[DEBUG] Attempting to extract colors from MTL file:",
              mtlUrl
            );

            const response = await fetch(mtlUrl);
            if (!response.ok) return null;

            const mtlContent = await response.text();
            const colors: Record<string, THREE.Color> = {};

            // Parse MTL file for material definitions
            const lines = mtlContent.split("\n");
            let currentMaterial = "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("newmtl ")) {
                currentMaterial = trimmed.substring(7);
              } else if (trimmed.startsWith("Kd ") && currentMaterial) {
                // Diffuse color
                const parts = trimmed.substring(3).split(" ").map(Number);
                if (parts.length >= 3) {
                  colors[currentMaterial] = new THREE.Color(
                    parts[0],
                    parts[1],
                    parts[2]
                  );
                }
              } else if (
                trimmed.startsWith("Ka ") &&
                currentMaterial &&
                !colors[currentMaterial]
              ) {
                // Ambient color (fallback if no diffuse)
                const parts = trimmed.substring(3).split(" ").map(Number);
                if (parts.length >= 3) {
                  colors[currentMaterial] = new THREE.Color(
                    parts[0],
                    parts[1],
                    parts[2]
                  );
                }
              }
            }

            console.log("[DEBUG] Extracted MTL colors:", colors);
            return Object.keys(colors).length > 0 ? colors : null;
          } catch (error) {
            console.log("[DEBUG] MTL color extraction failed:", error);
            return null;
          }
        };

        const root: THREE.Group =
          (gltf.scene as THREE.Group) || (gltf.scenes?.[0] as THREE.Group);
        if (!root) return;

        // Debug: Log all materials in the scene
        root.traverse((obj: THREE.Object3D) => {
          if (obj instanceof THREE.Mesh) {
            console.log("[DEBUG] Mesh found:", obj);
            console.log("[DEBUG] Mesh material:", obj.material);
            if (obj.material) {
              console.log("[DEBUG] Material type:", obj.material.type);
              const material = obj.material as THREE.Material & {
                color?: THREE.Color;
                map?: THREE.Texture;
              };
              console.log("[DEBUG] Material color:", material.color);
              console.log("[DEBUG] Material map:", material.map);
              console.log(
                "[DEBUG] Material properties:",
                Object.keys(obj.material)
              );
            }
          }
        });
        // Ensure only one model: clear the model group entirely before adding
        try {
          const group = currentObjectRef.current as THREE.Group;
          const children = [...group.children];
          for (const child of children) {
            group.remove(child);
            child.traverse((node: THREE.Object3D) => {
              const meshNode = node as THREE.Object3D & { isMesh?: boolean };
              if (meshNode.isMesh) {
                const realMesh = meshNode as unknown as THREE.Mesh;
                realMesh.geometry?.dispose?.();
                const mat = realMesh.material as
                  | THREE.Material
                  | THREE.Material[]
                  | undefined;
                if (Array.isArray(mat)) mat.forEach((mm) => mm?.dispose?.());
                else mat?.dispose?.();
              }
            });
          }
        } catch {}
        // Fit and center
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        root.position.sub(center);
        // Scale to a comfortable on-screen size (larger overall)
        const desiredMaxSize = 2.6; // target dimension in world units
        const currentMaxSize = Math.max(1e-3, Math.max(size.x, size.y, size.z));
        const scalar = desiredMaxSize / currentMaxSize;
        root.scale.multiplyScalar(scalar);
        baseScaleRef.current = root.scale.x;
        // Apply displacement effects while preserving original model colors
        root.traverse((obj: THREE.Object3D) => {
          if (obj instanceof THREE.Mesh) {
            const originalMaterial = obj.material;
            console.log(
              "[DEBUG] Processing mesh with material:",
              originalMaterial?.type
            );

            // Enhanced material enhancement system
            const hasValidColor = (mat: THREE.Material): boolean => {
              const m = mat as THREE.Material & {
                color?: THREE.Color;
                map?: THREE.Texture;
              };
              if (m.map) return true; // Has texture
              if (m.color) {
                const c = m.color;
                // Check if color is not monochromatic (not all RGB values are similar)
                const avg = (c.r + c.g + c.b) / 3;
                const variance = Math.sqrt(
                  (Math.pow(c.r - avg, 2) +
                    Math.pow(c.g - avg, 2) +
                    Math.pow(c.b - avg, 2)) /
                    3
                );
                return variance > 0.1; // Significant color variation
              }
              return false;
            };

            const enhanceMaterial = (
              material: THREE.Material,
              meshName: string
            ): THREE.Material => {
              const enhanced = material.clone();

              if (!hasValidColor(enhanced)) {
                console.log(
                  "[DEBUG] Material lacks proper colors, enhancing..."
                );

                // Generate song-aware colors based on track characteristics
                const generateSongColors = (): THREE.Color => {
                  // Use track title and artist for deterministic but varied colors
                  const seed = `${props.title}${props.artistNames}`;
                  let hash = 0;
                  for (let i = 0; i < seed.length; i++) {
                    hash =
                      ((hash << 5) - hash + seed.charCodeAt(i)) & 0xffffffff;
                  }

                  // Generate vibrant, varied colors
                  const hue = (hash % 360) / 360;
                  const saturation = 0.6 + ((hash >> 8) % 40) / 100; // 0.6-1.0
                  const lightness = 0.4 + ((hash >> 16) % 30) / 100; // 0.4-0.7

                  return new THREE.Color().setHSL(hue, saturation, lightness);
                };

                // Generate complementary colors for variety
                const generateComplementaryColors = (
                  baseColor: THREE.Color
                ): THREE.Color[] => {
                  const hsl = { h: 0, s: 0, l: 0 };
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

                const baseColor = generateSongColors();
                const complementaryColors =
                  generateComplementaryColors(baseColor);

                // Apply enhanced material properties
                if (enhanced instanceof THREE.MeshStandardMaterial) {
                  // Create a more sophisticated material
                  enhanced.color = baseColor;
                  enhanced.emissive = complementaryColors[0]
                    .clone()
                    .multiplyScalar(0.1);
                  enhanced.emissiveIntensity = 0.2;

                  // Vary material properties based on song characteristics
                  const titleHash = props.title
                    .split("")
                    .reduce((a, b) => a + b.charCodeAt(0), 0);
                  enhanced.metalness = 0.1 + (titleHash % 60) / 100; // 0.1-0.7
                  enhanced.roughness = 0.2 + (titleHash % 50) / 100; // 0.2-0.7

                  // Add subtle color variation across the mesh
                  enhanced.vertexColors = true;

                  // Create vertex colors for subtle variation
                  if (
                    obj instanceof THREE.Mesh &&
                    obj.geometry.attributes.position
                  ) {
                    const positions = obj.geometry.attributes.position.array;
                    const colors = new Float32Array(positions.length);

                    for (let i = 0; i < positions.length; i += 3) {
                      const x = positions[i];
                      const y = positions[i + 1];
                      const z = positions[i + 2];

                      // Create subtle color variation based on position
                      const noise =
                        Math.sin(x * 2) * Math.cos(y * 3) * Math.sin(z * 4);
                      const colorVariation = 0.1;

                      colors[i] = baseColor.r + noise * colorVariation;
                      colors[i + 1] = baseColor.g + noise * colorVariation;
                      colors[i + 2] = baseColor.b + noise * colorVariation;
                    }

                    (obj as THREE.Mesh).geometry.setAttribute(
                      "color",
                      new THREE.BufferAttribute(colors, 3)
                    );
                  }

                  console.log(
                    `[DEBUG] Applied enhanced material with color:`,
                    enhanced.color
                  );
                } else if (enhanced instanceof THREE.MeshBasicMaterial) {
                  enhanced.color = baseColor;
                  console.log(
                    `[DEBUG] Applied enhanced basic material with color:`,
                    enhanced.color
                  );
                } else if (enhanced instanceof THREE.MeshPhongMaterial) {
                  enhanced.color = baseColor;
                  enhanced.emissive = complementaryColors[0]
                    .clone()
                    .multiplyScalar(0.1);
                  enhanced.shininess = 30 + (props.title.length % 50);
                  console.log(
                    `[DEBUG] Applied enhanced phong material with color:`,
                    enhanced.color
                  );
                }
              }

              return enhanced;
            };

            // Store the original geometry for displacement calculations
            const originalGeometry = obj.geometry.clone();
            obj.userData.originalGeometry = originalGeometry;
            obj.userData.originalMaterial = originalMaterial;

            // If the material doesn't have proper colors, enhance it
            if (!hasValidColor(originalMaterial)) {
              obj.material = enhanceMaterial(originalMaterial, obj.name);
            }

            // Create a displacement modifier that works with any material
            const displacementModifier = {
              time: 0,
              amplitude: 0,
              apply: (time: number, amplitude: number) => {
                if (!obj.userData.originalGeometry) return;

                const geo = obj.userData.originalGeometry;
                const positions = geo.attributes.position.array;
                const normals = geo.attributes.normal.array;

                // Create a new geometry with displacement
                const newGeo = geo.clone();
                const newPositions = newGeo.attributes.position.array;

                // Smooth noise function for uniform distortion
                const smoothNoise = (
                  x: number,
                  y: number,
                  z: number,
                  time: number
                ) => {
                  // Generate smooth noise values using sine waves for uniformity
                  const noiseX = Math.sin(x * 0.5 + time * 0.1) * 0.5 + 0.5;
                  const noiseY = Math.sin(y * 0.5 + time * 0.08) * 0.5 + 0.5;
                  const noiseZ = Math.sin(z * 0.5 + time * 0.12) * 0.5 + 0.5;

                  // Combine with smooth interpolation
                  const combined = (noiseX + noiseY + noiseZ) / 3;
                  return combined;
                };

                for (let i = 0; i < positions.length; i += 3) {
                  const x = positions[i];
                  const y = positions[i + 1];
                  const z = positions[i + 2];

                  // Generate smooth, uniform displacement
                  const noise = smoothNoise(x, y, z, time);
                  // Convert from 0-1 range to -1 to 1 range, then apply amplitude
                  const disp = (noise - 0.5) * 2.0 * amplitude;

                  // Apply displacement along normal direction
                  const nx = normals[i];
                  const ny = normals[i + 1];
                  const nz = normals[i + 2];

                  newPositions[i] = x + nx * disp;
                  newPositions[i + 1] = y + ny * disp;
                  newPositions[i + 2] = z + nz * disp;
                }

                newGeo.attributes.position.needsUpdate = true;
                newGeo.computeVertexNormals();

                // Update the mesh geometry
                obj.geometry.dispose();
                obj.geometry = newGeo;
              },
            };

            // Store the modifier for animation updates
            obj.userData.displacementModifier = displacementModifier;
          }
        });
        // Add the GLTF root into the dedicated model group
        currentObjectRef.current?.add(root);
        currentObjectRef.current = root;
        setMeshyStatus(null);
        setModelReady(true);
      } catch {
        // ignore and keep fallback primitive
        setMeshyStatus((prev) => prev ?? "meshy failed — using fallback");
      } finally {
        modelLoadInProgressRef.current = false;
      }
    };
    // Always try Meshy; it will replace the primitive when ready
    void tryLoadMeshyModel();

    // simple pointer rotation
    let isPointerDown = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e: PointerEvent) => {
      isPointerDown = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerUp = () => {
      isPointerDown = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isPointerDown) return;
      const dx = (e.clientX - lastX) * 0.003;
      const obj = currentObjectRef.current;
      if (!obj) return;
      // Restrict interaction to y-axis rotation only; ignore x-axis tilt
      obj.rotation.y += dx;
      // Keep other axes stable
      obj.rotation.x = 0;
      obj.rotation.z = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      // Safety: ensure model group contains at most one child
      try {
        const group = currentObjectRef.current as THREE.Group;
        if (group && group.children.length > 1) {
          const extras = group.children.slice(0, -1);
          extras.forEach((extra) => group.remove(extra));
        }
      } catch {}
    };
    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);

    // resize
    const onResize = () => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // animate
    const tick = (t: number) => {
      const time = t * 0.001;
      const analyserNode = analyserLatestRef.current;
      const fft = fftLatestRef.current;
      if (analyserNode && fft && recipe) {
        try {
          analyserNode.getByteFrequencyData(
            fft as unknown as Uint8Array<ArrayBuffer>
          );
        } catch {}
        // Improved FFT processing for uniform distortion
        const lowIdx = recipe.audioMapping?.fftBands?.low ?? 2;
        const midIdx = recipe.audioMapping?.fftBands?.mid ?? 24;
        const highIdx = recipe.audioMapping?.fftBands?.high ?? 96;

        // Get frequency band values with smoothing
        const low = (fft as Uint8Array)[lowIdx] ?? 0;
        const mid = (fft as Uint8Array)[midIdx] ?? 0;
        const high = (fft as Uint8Array)[highIdx] ?? 0;

        // Apply smoothing to reduce spiky behavior
        const smoothingFactor = 0.85;
        const smoothedLow = (low + (lastLowRef.current ?? low)) / 2;
        const smoothedMid = (mid + (lastMidRef.current ?? mid)) / 2;
        const smoothedHigh = (high + (lastHighRef.current ?? high)) / 2;

        // Store for next frame
        lastLowRef.current = smoothedLow;
        lastMidRef.current = smoothedMid;
        lastHighRef.current = smoothedHigh;

        // Calculate energy with better normalization and smoothing
        const energy = (smoothedLow + smoothedMid + smoothedHigh) / (3 * 255);
        const smoothedEnergy = THREE.MathUtils.lerp(
          lastEnergyRef.current ?? energy,
          energy,
          1 - smoothingFactor
        );
        lastEnergyRef.current = smoothedEnergy;

        const baseAmp =
          (recipe.deformation as { amplitude?: number } | undefined)
            ?.amplitude ?? 0.3;
        const combined = 0.55 * smoothedEnergy + 0.45 * spotifyScalar;
        const amplitude = baseAmp * combined;

        // Update displacement for all meshes using the new modifier system
        if (currentObjectRef.current) {
          currentObjectRef.current.traverse((obj: THREE.Object3D) => {
            if (
              obj instanceof THREE.Mesh &&
              obj.userData.displacementModifier
            ) {
              const modifier = obj.userData.displacementModifier;
              modifier.apply(time, amplitude);
            }
          });
        }

        const obj = currentObjectRef.current;
        if (obj) {
          // Always enforce single-axis rotation constraint (y-axis)
          obj.rotation.x = 0;
          obj.rotation.z = 0;
          // Rotate only while audio is playing; lock to y-axis; speed scaled by BPM
          if (isPlayingRef.current) {
            const bpm = tempoRef.current || 120;
            // Base radians/sec from BPM: one full rotation every 8 beats
            const baseRadsPerSec = ((bpm / 60) * (2 * Math.PI)) / 8;
            // Mild modulation with energy
            const radsPerSec = baseRadsPerSec * (0.9 + 0.2 * energy);
            // Approximate frame delta using requestAnimationFrame timestamp
            const now = performance.now();
            let dt = (now - (lastTickTimeRef.current || now)) / 1000;
            lastTickTimeRef.current = now;
            // Clamp delta to avoid large jumps when tab was inactive
            dt = Math.min(0.05, Math.max(0.001, dt));
            obj.rotation.y += radsPerSec * dt;
          }

          // Audio-reactive uniform scale around the original fitted scale
          const scalePulse = 1 + 0.25 * energy; // 0–25% growth
          const target = baseScaleRef.current * scalePulse;
          // Smooth a bit to avoid jitter
          const lerp = THREE.MathUtils.lerp(obj.scale.x, target, 0.25);
          obj.scale.setScalar(lerp);
        }
      }
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    // store refs
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    onResize();

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", onResize);
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      if (currentObjectRef.current) {
        try {
          const group = currentObjectRef.current as THREE.Group;
          const children = [...group.children];
          children.forEach((c) => group.remove(c));
          scene.remove(group);
        } catch {}
        currentObjectRef.current = null;
      }

      renderer.dispose();
      // Remove canvas so we don't accumulate multiple canvases
      try {
        if (canvasRef.current && canvasRef.current.parentElement) {
          canvasRef.current.parentElement.removeChild(canvasRef.current);
        }
      } catch {}
      canvasRef.current = null;
    };
  }, [recipe, spotifyScalar, props.spotifyId]);

  // Loading shimmer effect for 3-character sweep across the message
  const ShimmerText = ({ text }: { text: string }) => {
    const [idx, setIdx] = useState(0);
    const [dir, setDir] = useState<1 | -1>(1);
    const width = 3; // highlight width in characters
    useEffect(() => {
      const interval = setInterval(() => {
        setIdx((prev) => {
          const next = prev + dir;
          if (next < 0) {
            setDir(1);
            return 0;
          }
          if (next > Math.max(0, text.length - width)) {
            setDir(-1);
            return Math.max(0, text.length - width);
          }
          return next;
        });
      }, 90);
      return () => clearInterval(interval);
    }, [text, dir]);

    const start = Math.min(idx, Math.max(0, text.length - width));
    const end = Math.min(text.length, start + width);
    const left = text.slice(0, start);
    const mid = text.slice(start, end);
    const right = text.slice(end);
    return (
      <span style={{ fontWeight: 600, letterSpacing: 0.3 }}>
        <span style={{ color: "#9aa0a6" }}>{left}</span>
        <span
          style={{
            backgroundImage:
              "linear-gradient(90deg, rgba(255,255,255,0.25), rgba(255,255,255,0.95), rgba(255,255,255,0.25))",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            textShadow: "0 0 18px rgba(255,255,255,0.15)",
          }}
        >
          {mid}
        </span>
        <span style={{ color: "#9aa0a6" }}>{right}</span>
      </span>
    );
  };

  const currentLoadingMessage = useMemo(() => {
    if (phase === "analyzing") return "Analyzing track";
    if (phase === "thinking") {
      const prompt = (meshyPrompt || "thinking of ideas").toString();
      return `Thinking of ideas — ${prompt}`;
    }
    if (phase === "visualizing") return "Visualizing";
    return "Creating scene";
  }, [phase, meshyPrompt]);

  if (error) {
    return (
      <div>
        <TrackPlayer
          {...props}
          previewUrl={resolvedPreviewUrl ?? undefined}
          onPlayingChange={setIsPlaying}
          onAnalyserReady={handleAnalyserReady}
        />
        <div style={{ color: "red", marginTop: 12 }}>{error}</div>
      </div>
    );
  }

  if (!modelReady) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          minHeight: 0,
        }}
      >
        {/* 3D Visualizer Area - Top */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            width: "100%",
            position: "relative",
            background:
              "radial-gradient(60% 60% at 50% 20%, rgba(80,38,125,0.45) 0%, rgba(18,12,24,0.85) 48%, #07070a 100%)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                color: "#cfd3da",
                textAlign: "center",
                maxWidth: 880,
                width: "100%",
                padding: "0 16px",
              }}
            >
              <div style={{ fontSize: 20, lineHeight: 1.25 }}>
                <ShimmerText text={currentLoadingMessage} />
              </div>
            </div>
          </div>
        </div>

        {/* Music Player - Bottom */}
        <div
          style={{
            padding: "24px",
            background: "rgba(14,14,18,0.94)",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div style={{ maxWidth: "500px", width: "100%" }}>
            <TrackPlayer
              {...props}
              previewUrl={resolvedPreviewUrl ?? undefined}
              onPlayingChange={setIsPlaying}
              onAnalyserReady={handleAnalyserReady}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        minHeight: 0,
      }}
    >
      {/* 3D Visualizer Area - Top */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          width: "100%",
          position: "relative",
          background:
            "radial-gradient(60% 60% at 50% 20%, rgba(80,38,125,0.45) 0%, rgba(18,12,24,0.85) 48%, #07070a 100%)",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
          }}
        />
      </div>

      {/* Music Player - Bottom */}
      <div
        style={{
          padding: "24px",
          background: "rgba(14,14,18,0.94)",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div style={{ maxWidth: "500px", width: "100%" }}>
          <TrackPlayer
            {...props}
            previewUrl={resolvedPreviewUrl ?? undefined}
            onPlayingChange={setIsPlaying}
            onAnalyserReady={handleAnalyserReady}
          />
        </div>
      </div>
    </div>
  );
}
