"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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

export default function TrackVisualClient(props: Props) {
  // Audio/preview state
  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState<string | null>(
    props.previewUrl ?? null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [fftArray, setFftArray] = useState<Uint8Array | null>(null);
  // Keep latest analyser/FFT in refs so the render effect does not re-init
  const analyserLatestRef = useRef<AnalyserNode | null>(null);
  const fftLatestRef = useRef<Uint8Array | null>(null);

  // Data state
  const [features, setFeatures] = useState<SpotifyFeatures | null>(null);
  const [recipe, setRecipe] = useState<VisualizerRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meshyStatus, setMeshyStatus] = useState<string | null>(null);

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

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

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
        if (!aborted) setRecipe(data);
      } catch (e) {
        if (!aborted)
          setError(e instanceof Error ? e.message : "Failed to get recipe");
      }
    };
    run();
    return () => {
      aborted = true;
    };
  }, [props.spotifyId]);

  // // Fetch Spotify audio features used by recipe weights
  // useEffect(() => {
  //   const id = props.spotifyId;
  //   if (!id) return;
  //   let aborted = false;
  //   const run = async () => {
  //     try {
  //       const r = await fetch(`/api/spotify/features/${id}`, {
  //         cache: "no-store",
  //       });
  //       if (!r.ok) throw new Error(await r.text());
  //       const data = (await r.json()) as SpotifyFeatures;
  //       if (!aborted) setFeatures(data);
  //     } catch (e) {
  //       // Non-fatal; the visualizer will still run driven by FFT
  //       if (!aborted) setFeatures(null);
  //     }
  //   };
  //   run();
  //   return () => {
  //     aborted = true;
  //   };
  // }, [props.spotifyId]);

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
    setAnalyser(node);
    try {
      const arr = new Uint8Array(node.frequencyBinCount);
      setFftArray(arr);
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
    if (!canvasRef.current) {
      container.appendChild(renderer.domElement);
      canvasRef.current = renderer.domElement;
    }

    // lights (tag for identification)
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 5, 5);
    const amb = new THREE.AmbientLight(0xffffff, 0.5);
    (dirLight as any).isLight = true;
    (amb as any).isLight = true;
    scene.add(amb);
    scene.add(dirLight);

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
    const uniforms = {
      u_time: { value: 0 },
      u_amplitude: { value: 0 },
      u_color: { value: new THREE.Vector3(r, g, b) },
      u_lightDir: { value: new THREE.Vector3(0.5, 0.8, 0.6).normalize() },
    };
    const vertexShader = `
      varying vec3 vNormal;
      varying vec3 vPos;
      uniform float u_time;
      uniform float u_amplitude;
      float hash(vec3 p){ p = fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 p){
        vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
        float n = mix(
          mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y),
          f.z);
        return n;
      }
      void main(){
        vNormal = normalMatrix * normalize(normal);
        vec3 pos = position;
        float n = noise(normalize(position)*2.0 + vec3(0.0, u_time*0.25, 0.0));
        float disp = (n-0.5)*2.0*u_amplitude;
        pos += normalize(normal) * disp;
        vPos = (modelViewMatrix * vec4(pos, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `;
    const fragmentShader = `
      precision mediump float;
      varying vec3 vNormal; varying vec3 vPos;
      uniform vec3 u_color; uniform vec3 u_lightDir;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 L = normalize(u_lightDir);
        float lambert = max(dot(N, L), 0.0);
        vec3 base = u_color;
        vec3 col = base * (0.4 + 0.6 * lambert);
        gl_FragColor = vec4(col, 1.0);
      }
    `;
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      lights: false,
    });

    // Defer adding any geometry until Meshy model is ready

    // If GPT selected a custom metaphor, try to replace the fallback primitive with a Meshy-generated model
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

        console.log(`[CLIENT] Requesting Meshy prompt/model for track ID: ${props.spotifyId}`);

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

        const promptJson = (await promptRes.json()) as { prompt?: string; modelUrl?: string };
        let modelUrl: string | null = null;
        if (promptJson.modelUrl) {
          console.log(`[CLIENT] Using cached Meshy model URL: ${promptJson.modelUrl}`);
          modelUrl = promptJson.modelUrl;
        }

        let startJson: { id?: string } = {};
        if (!modelUrl) {
          if (!promptJson.prompt) return;
          const prompt = promptJson.prompt;
          console.log(`[CLIENT] Starting Meshy 3D generation with prompt: "${prompt}"`);

          const startRes = await fetch(`/api/visualizer/meshy/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
          });

          if (!startRes.ok) {
            const txt = await startRes.text();
            console.log(`[CLIENT] Meshy start error: ${startRes.status} - ${txt}`);
            setMeshyStatus(`meshy start error: ${startRes.status}`);
            console.warn("meshy start error", txt);
            return;
          }

          startJson = (await startRes.json()) as { id?: string };
          console.log(`[CLIENT] Meshy generation started with ID: ${startJson.id}`);
          if (!startJson.id) return;
        }

        const pickModelUrl = (j: any): string | null => {
          if (typeof j?.model_url === "string") return j.model_url as string;
          if (typeof j?.modelUrl === "string") return j.modelUrl as string;
          const tryModelUrls = (obj: any): string | null => {
            if (!obj || typeof obj !== "object") return null;
            const glb = (obj as any).glb ?? (obj as any).GLB;
            const gltf = (obj as any).gltf ?? (obj as any).GLTF;
            if (typeof glb === "string") return glb;
            if (typeof gltf === "string") return gltf;
            return null;
          };
          const direct = tryModelUrls(j.model_urls) || tryModelUrls(j.modelUrls);
          if (direct) return direct;
          const fromAssets = (arr: any[]): string | null => {
            for (const a of arr) {
              const url = typeof a?.url === "string" ? (a.url as string) : null;
              const format = (a?.format ?? a?.type ?? a?.mimeType ?? "").toString().toLowerCase();
              if (url && (url.endsWith(".glb") || url.endsWith(".gltf"))) return url;
              if (url && (format.includes("glb") || format.includes("gltf"))) return url;
            }
            // fallback: first url string
            const anyUrl = arr.find((a) => typeof a?.url === "string");
            return anyUrl?.url ?? null;
          };
          if (Array.isArray((j as any).assets)) {
            const u = fromAssets((j as any).assets);
            if (u) return u;
          }
          if (Array.isArray((j as any).files)) {
            const u = fromAssets((j as any).files);
            if (u) return u;
          }
          return null;
        };
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const s = await fetch(
            `/api/visualizer/meshy/status?id=${encodeURIComponent(
              startJson.id!
            )}`,
            { cache: "no-store" }
          );
          if (!s.ok) continue;
          const j = (await s.json()) as any;
          setMeshyStatus(`meshy status: ${j.status ?? "pending"}`);
          const picked = pickModelUrl(j);
          if (picked) {
            modelUrl = picked;
            console.log(`[CLIENT] Meshy model URL selected: ${modelUrl}`);
            break;
          }
          if (j.status && /failed|canceled/i.test(j.status)) break;
        }
        if (!modelUrl) return;

        if (!gltfLoaderRef.current) gltfLoaderRef.current = new GLTFLoader();
        const proxiedUrl = `/api/visualizer/meshy/fetch?url=${encodeURIComponent(
          modelUrl!
        )}`;
        // Always dispose and replace the loader to avoid parallel loads adding twice
        try { (gltfLoaderRef.current as any).manager?.itemEnd?.(proxiedUrl); } catch {}
        gltfLoaderRef.current = new GLTFLoader();
        const gltf = await new Promise<any>((resolve, reject) => {
          gltfLoaderRef.current!.load(proxiedUrl, resolve, undefined, reject);
        });
        const root: THREE.Group = gltf.scene || gltf.scenes?.[0];
        if (!root) return;
        // Ensure only one model: clear the model group entirely before adding
        try {
          const group = currentObjectRef.current as THREE.Group;
          const children = [...group.children];
          for (const child of children) {
            group.remove(child);
            child.traverse((node) => {
              const m = node as any;
              if (m.isMesh) {
                m.geometry?.dispose?.();
                if (Array.isArray(m.material)) m.material.forEach((mm: any) => mm?.dispose?.());
                else m.material?.dispose?.();
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
        // Apply our shader to every mesh so displacement still works
        root.traverse((obj) => {
          const m = obj as any;
          if (m.isMesh) {
            m.material = material;
            m.geometry.computeVertexNormals?.();
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
      }
      finally {
        modelLoadInProgressRef.current = false;
      }
    };
    // Always try Meshy; it will replace the primitive when ready
    void tryLoadMeshyModel();

    // simple pointer rotation
    let isPointerDown = false;
    let lastX = 0,
      lastY = 0;
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
      const dx = (e.clientX - lastX) * 0.005;
      const dy = (e.clientY - lastY) * 0.005;
        const obj = currentObjectRef.current;
      if (!obj) return;
      obj.rotation.y += dx;
      obj.rotation.x += dy;
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
      uniforms.u_time.value = t * 0.001;
      const analyserNode = analyserLatestRef.current;
      const fft = fftLatestRef.current;
      if (analyserNode && fft && recipe) {
        try {
          analyserNode.getByteFrequencyData(
            fft as unknown as Uint8Array<ArrayBuffer>
          );
        } catch {}
        const lowIdx = recipe.audioMapping?.fftBands?.low ?? 2;
        const midIdx = recipe.audioMapping?.fftBands?.mid ?? 24;
        const highIdx = recipe.audioMapping?.fftBands?.high ?? 96;
        const low = (fft as Uint8Array)[lowIdx] ?? 0;
        const mid = (fft as Uint8Array)[midIdx] ?? 0;
        const high = (fft as Uint8Array)[highIdx] ?? 0;
        const energy = (low + mid + high) / (3 * 255);
        const baseAmp = (recipe.deformation as any)?.amplitude ?? 0.3;
        const combined = 0.55 * energy + 0.45 * spotifyScalar;
        uniforms.u_amplitude.value = baseAmp * combined;

        const obj = currentObjectRef.current;
        if (obj) {
          // Rotate only while audio is playing
          if (isPlayingRef.current) {
            const rotSpeed = 0.004 + 0.018 * energy;
            obj.rotation.y += rotSpeed;
            obj.rotation.x += 0.002 * (low / 255);
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
    materialRef.current = material;

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
      material.dispose();
      renderer.dispose();
      // Remove canvas so we don't accumulate multiple canvases
      try {
        if (canvasRef.current && canvasRef.current.parentElement) {
          canvasRef.current.parentElement.removeChild(canvasRef.current);
        }
      } catch {}
      canvasRef.current = null;
    };
  }, [recipe]);

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
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0 }}>
        {/* 3D Visualizer Area - Top */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            width: "100%",
            position: "relative",
            background: "radial-gradient(60% 60% at 50% 20%, rgba(80,38,125,0.45) 0%, rgba(18,12,24,0.85) 48%, #07070a 100%)",
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
                color: "#9aa0a6",
                textAlign: "center",
                padding: "14px 18px",
                background: "rgba(14,14,18,0.5)",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Loading visualizer...
            </div>
          </div>
        </div>
        
        {/* Music Player - Bottom */}
        <div style={{ 
          padding: "24px", 
          background: "rgba(14,14,18,0.94)",
          display: "flex",
          justifyContent: "center"
        }}>
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
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0 }}>
      {/* 3D Visualizer Area - Top */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          width: "100%",
          position: "relative",
          background: "radial-gradient(60% 60% at 50% 20%, rgba(80,38,125,0.45) 0%, rgba(18,12,24,0.85) 48%, #07070a 100%)",
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
      <div style={{ 
        padding: "24px", 
        background: "rgba(14,14,18,0.94)",
        display: "flex",
        justifyContent: "center"
      }}>
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
