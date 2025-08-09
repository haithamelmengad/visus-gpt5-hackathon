"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { VisualizerRecipe } from "@/types/visualizer";

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function useAudioAnalyser(previewUrl: string | null) {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null);
  const [fftArray, setFftArray] = useState<Uint8Array | null>(null);

  useEffect(() => {
    if (!previewUrl) return;
    let ctx: AudioContext | null = null;
    let source: MediaElementAudioSourceNode | null = null;
    let audio: HTMLAudioElement | null = null;
    let analyserNode: AnalyserNode | null = null;
    const raf = 0;

    const setup = async () => {
      ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 2048;
      analyserNode.smoothingTimeConstant = 0.85;

      audio = new Audio(previewUrl);
      audio.crossOrigin = "anonymous";
      audio.loop = true;
      audio.play().catch(() => {});

      source = ctx.createMediaElementSource(audio);
      source.connect(analyserNode);
      analyserNode.connect(ctx.destination);
      setAnalyser(analyserNode);
      setAudioCtx(ctx);
      setFftArray(new Uint8Array(analyserNode.frequencyBinCount));
    };

    setup();
    return () => {
      cancelAnimationFrame(raf);
      if (audio) audio.pause();
      source?.disconnect();
      analyserNode?.disconnect();
      if (ctx) ctx.close();
    };
  }, [previewUrl]);

  return { analyser, audioCtx, fftArray } as const;
}

type SpotifyFeatures = Record<string, number | string | null | undefined>;
function useSpotifyWeights(
  features: SpotifyFeatures | null,
  recipe?: VisualizerRecipe | null
) {
  return useMemo(() => {
    const weights = recipe?.audioMapping.spotifyWeights ?? {};
    const entries = Object.entries(weights) as Array<
      [keyof SpotifyFeatures, number]
    >;
    const weighted = entries.reduce((acc, [k, w]) => {
      const base = features?.[k];
      const v = typeof base === "number" ? base : 0;
      acc += v * w;
      return acc;
    }, 0 as number);
    return weighted; // scalar in [~0, ~1]
  }, [features, recipe]);
}

function hexToColorVec3(hex: string): THREE.Vector3 {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return new THREE.Vector3(r, g, b);
}

// Next.js page props typing varies by version; accept unknown for compatibility
const VisualizerPage = (props: unknown) => {
  const id = ((props as { params?: { id?: string } })?.params?.id ??
    "") as string;
  type Track = {
    id: string;
    name: string;
    artists?: { name: string }[];
    album?: { name?: string };
    popularity?: number;
    preview_url?: string | null;
  };
  const [track, setTrack] = useState<Track | null>(null);
  const [features, setFeatures] = useState<SpotifyFeatures | null>(null);
  const [recipe, setRecipe] = useState<VisualizerRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const load = async () => {
      try {
        const t = await fetchJSON<Track>(`/api/spotify/track/${id}`);
        setTrack(t);
        // prime preview URL from Spotify payload if present
        setPreviewUrl(t?.preview_url ?? null);
        const f = await fetchJSON<SpotifyFeatures>(
          `/api/spotify/features/${id}`
        );
        setFeatures(f);
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Failed to load track data";
        setError(msg);
      }
    };
    load();
  }, [id]);

  // If the Spotify track payload lacks preview_url, use our finder API
  useEffect(() => {
    const fetchPreview = async () => {
      if (!track) return;
      if (track.preview_url) return; // already have one
      try {
        const artistNames = (track.artists || []).map((a) => a.name).join(", ");
        const r = await fetch(
          `/api/preview?title=${encodeURIComponent(
            track.name
          )}&artist=${encodeURIComponent(artistNames)}&limit=1`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const data = await r.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        const first = results[0];
        const urls: string[] = Array.isArray(first?.previewUrls)
          ? first.previewUrls
          : [];
        if (urls.length > 0) setPreviewUrl(urls[0]);
      } catch {
        // ignore, UI will just render without audio
      }
    };
    fetchPreview();
  }, [track]);

  useEffect(() => {
    const make = async () => {
      if (!track || !features) return;
      try {
        const r = await fetch(`/api/visualizer/recipe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spotifyId: track.id,
            includeAnalysis: false,
          }),
        });
        if (!r.ok) throw new Error(await r.text());
        const data = (await r.json()) as VisualizerRecipe;
        setRecipe(data);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to create recipe";
        setError(msg);
      }
    };
    make();
  }, [track, features]);

  const { analyser, fftArray } = useAudioAnalyser(previewUrl);
  const spotifyScalar = useSpotifyWeights(features, recipe);

  // Initialize Three.js scene and animate with shader displacement
  useEffect(() => {
    if (!containerRef.current || !recipe) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 100);
    camera.position.set(0, 0, 4.5);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas: canvasRef.current ?? undefined,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    if (!canvasRef.current) {
      container.appendChild(renderer.domElement);
      canvasRef.current = renderer.domElement;
    }

    // lights
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(5, 5, 5);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    scene.add(dirLight);

    // geometry
    const p = recipe.baseParams || {};
    let geometry: THREE.BufferGeometry;
    switch (recipe.baseGeometry) {
      case "box":
        geometry = new THREE.BoxGeometry(
          p.width ?? 1.2,
          p.height ?? 1.2,
          p.depth ?? 1.2,
          64,
          64,
          64
        );
        break;
      case "plane":
        geometry = new THREE.PlaneGeometry(
          p.width ?? 2.5,
          p.height ?? 2.5,
          256,
          256
        );
        break;
      case "torus":
        geometry = new THREE.TorusGeometry(
          p.radius ?? 0.9,
          p.tube ?? 0.35,
          256,
          128
        );
        break;
      case "cylinder":
        geometry = new THREE.CylinderGeometry(
          p.radiusTop ?? 0.8,
          p.radiusBottom ?? 0.8,
          p.height ?? 1.6,
          128,
          32
        );
        break;
      case "sphere":
      default:
        geometry = new THREE.SphereGeometry(p.radius ?? 1.1, 256, 256);
        break;
    }

    // material (shader)
    const primary = hexToColorVec3(recipe.colorPalette?.[0] ?? "#ffffff");
    const uniforms = {
      u_time: { value: 0 },
      u_amplitude: { value: 0 },
      u_color: { value: new THREE.Vector3(primary.x, primary.y, primary.z) },
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
        vNormal = normalMatrix * normal;
        vec3 pos = position;
        float n = noise(normalize(position)*2.0 + vec3(0.0, u_time*0.25, 0.0));
        float disp = (n-0.5)*2.0*u_amplitude;
        pos += normal * disp;
        vPos = (modelViewMatrix * vec4(pos, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `;
    const fragmentShader = `
      precision highp float;
      varying vec3 vNormal; varying vec3 vPos;
      uniform vec3 u_color; uniform vec3 u_lightDir;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 L = normalize(u_lightDir);
        float lambert = max(dot(N, L), 0.0);
        vec3 base = u_color;
        vec3 col = base * (0.2 + 0.8 * lambert);
        gl_FragColor = vec4(col, 1.0);
      }
    `;
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      lights: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // orbit-like simple mouse control: rotate mesh with pointer
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
      mesh.rotation.y += dx;
      mesh.rotation.x += dy;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);

    // resize
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // animate
    const tick = (t: number) => {
      uniforms.u_time.value = t * 0.001;
      if (analyser && fftArray) {
        analyser.getByteFrequencyData(
          fftArray as unknown as Uint8Array<ArrayBuffer>
        );
        const low =
          (fftArray as Uint8Array)[recipe.audioMapping.fftBands.low] ?? 0;
        const mid =
          (fftArray as Uint8Array)[recipe.audioMapping.fftBands.mid] ?? 0;
        const high =
          (fftArray as Uint8Array)[recipe.audioMapping.fftBands.high] ?? 0;
        const energy = (low + mid + high) / (3 * 255);
        const baseAmp =
          recipe.deformation.type === "noise"
            ? recipe.deformation.amplitude
            : recipe.deformation.amplitude;
        uniforms.u_amplitude.value =
          baseAmp * (0.55 * energy + 0.45 * spotifyScalar);
        mesh.rotation.y += 0.002 + 0.01 * energy;
      }
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    // store refs
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    meshRef.current = mesh;
    materialRef.current = material;

    onResize();

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", onResize);
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      // keep canvas for hydration safety
    };
  }, [recipe, analyser, fftArray, spotifyScalar]);

  if (error) return <div style={{ padding: 24, color: "red" }}>{error}</div>;
  if (!track || !recipe)
    return <div style={{ padding: 24 }}>Loading visualizer…</div>;

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100vh", position: "relative" }}
    >
      <canvas ref={canvasRef} />
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          color: "white",
          textShadow: "0 1px 2px rgba(0,0,0,0.7)",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16 }}>{track.name}</div>
        <div style={{ opacity: 0.85 }}>
          {track.artists?.map((a) => a.name).join(", ")}
        </div>
      </div>
    </div>
  );
};

export default VisualizerPage;
