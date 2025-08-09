"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
  const meshRef = useRef<THREE.Mesh | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const frameRef = useRef<number | null>(null);
  const gltfLoaderRef = useRef<GLTFLoader | null>(null);

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
          body: JSON.stringify({ spotifyId: id, includeAnalysis: false }),
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

  // Fetch Spotify audio features used by recipe weights
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
      } catch (e) {
        // Non-fatal; the visualizer will still run driven by FFT
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
    setAnalyser(node);
    try {
      setFftArray(new Uint8Array(node.frequencyBinCount));
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

    // lights
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 5, 5);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    scene.add(dirLight);

    // geometry from recipe (supports custom metaphor shapes)
    const p = recipe.baseParams || {};
    let geometry: THREE.BufferGeometry;
    const makeCustomGeometry = (kind?: string): THREE.BufferGeometry | null => {
      if (!kind) return null;
      switch (kind) {
        case "sunglasses": {
          // Minimal stylized sunglasses: two torus-rims + small bridge + simple bars
          const group = new THREE.Group();
          const rimR = (p as any).rimRadius ?? 0.6;
          const rimT = (p as any).rimTube ?? 0.08;
          const bridge = (p as any).bridge ?? 0.25;
          const eyeGap = (p as any).eyeGap ?? 0.2;
          const geoL = new THREE.TorusGeometry(rimR, rimT, 24, 72);
          const geoR = new THREE.TorusGeometry(rimR, rimT, 24, 72);
          const mat = new THREE.MeshBasicMaterial();
          const meshL = new THREE.Mesh(geoL, mat);
          const meshR = new THREE.Mesh(geoR, mat);
          meshL.position.x = -(rimR + eyeGap / 2);
          meshR.position.x = +(rimR + eyeGap / 2);
          group.add(meshL, meshR);
          const bridgeGeo = new THREE.CylinderGeometry(
            rimT * 0.9,
            rimT * 0.9,
            bridge,
            12,
            1
          );
          const bridgeMesh = new THREE.Mesh(bridgeGeo, mat);
          bridgeMesh.rotation.z = Math.PI / 2;
          group.add(bridgeMesh);
          // Flatten into single BufferGeometry
          const merged = mergeGeometries(
            [
              geoL.toNonIndexed(),
              geoR.toNonIndexed(),
              bridgeGeo.toNonIndexed(),
            ],
            true
          ) as THREE.BufferGeometry | null;
          if (merged) {
            merged.computeVertexNormals();
            return merged;
          }
          // Fallback: approximate with a wide torus
          return new THREE.TorusGeometry(rimR * 1.9 + eyeGap, rimT, 24, 96);
        }
        case "lightbulb": {
          // Bulb: sphere top + small cylinder base
          const bulbR = (p as any).radius ?? 0.9;
          const neckH = (p as any).neckHeight ?? 0.35;
          const neckR = (p as any).neckRadius ?? 0.35;
          const sphere = new THREE.SphereGeometry(bulbR, 192, 192);
          // Clip lower hemisphere for bulb look by translating up and relying on displacement
          sphere.translate(0, neckH * 0.2, 0);
          const cyl = new THREE.CylinderGeometry(
            neckR,
            neckR * 1.05,
            neckH,
            64,
            1
          );
          cyl.translate(0, -bulbR * 0.8, 0);
          const merged = mergeGeometries(
            [sphere.toNonIndexed(), cyl.toNonIndexed()],
            true
          ) as THREE.BufferGeometry | null;
          if (merged) {
            merged.computeVertexNormals();
            return merged;
          }
          return sphere;
        }
        case "vinyl": {
          const outer = (p as any).radius ?? 1.2;
          const inner = (p as any).innerRadius ?? 0.15;
          return new THREE.RingGeometry(inner, outer, 256, 1);
        }
        case "heart": {
          // Parametric 3D heart via lathe profile
          const points: THREE.Vector2[] = [];
          for (let t = 0; t <= Math.PI; t += Math.PI / 80) {
            const x = 0.8 * Math.pow(Math.sin(t), 3);
            const y =
              0.6 * Math.cos(t) -
              0.3 * Math.cos(2 * t) -
              0.05 * Math.cos(3 * t) -
              0.2;
            points.push(new THREE.Vector2(Math.abs(x), y));
          }
          const g = new THREE.LatheGeometry(points, 160);
          g.computeVertexNormals();
          return g;
        }
        case "star": {
          const r1 = (p as any).radius ?? 1.1;
          const r2 = r1 * 0.5;
          const spikes = (p as any).spikes ?? 5;
          const shape = new THREE.Shape();
          for (let i = 0; i < spikes * 2; i++) {
            const r = i % 2 === 0 ? r1 : r2;
            const a = (i / (spikes * 2)) * Math.PI * 2;
            const x = Math.cos(a) * r;
            const y = Math.sin(a) * r;
            if (i === 0) shape.moveTo(x, y);
            else shape.lineTo(x, y);
          }
          shape.closePath();
          const g = new THREE.ExtrudeGeometry(shape, {
            depth: 0.3,
            bevelEnabled: true,
            bevelSize: 0.05,
            bevelSegments: 2,
          });
          g.computeVertexNormals();
          return g;
        }
        case "bolt": {
          // Simple lightning bolt silhouette extruded
          const s = new THREE.Shape();
          s.moveTo(-0.2, 0.7);
          s.lineTo(0.1, 0.1);
          s.lineTo(-0.05, 0.1);
          s.lineTo(0.2, -0.7);
          s.lineTo(-0.1, -0.1);
          s.lineTo(0.05, -0.1);
          s.lineTo(-0.2, 0.7);
          const g = new THREE.ExtrudeGeometry(s, {
            depth: 0.25,
            bevelEnabled: false,
          });
          g.computeVertexNormals();
          return g;
        }
        case "music_note": {
          const r = (p as any).noteRadius ?? 0.25;
          const staff = (p as any).staffHeight ?? 1.2;
          const cyl = new THREE.CylinderGeometry(0.06, 0.06, staff, 12, 1);
          cyl.translate(0.35, 0.2, 0);
          const head = new THREE.SphereGeometry(r, 64, 64);
          head.translate(0, -staff * 0.45, 0);
          const merged = mergeGeometries(
            [cyl.toNonIndexed(), head.toNonIndexed()],
            true
          ) as THREE.BufferGeometry | null;
          if (merged) {
            merged.computeVertexNormals();
            return merged;
          }
          return head;
        }
        default:
          return null;
      }
    };

    switch (recipe.baseGeometry) {
      case "box":
        geometry = new THREE.BoxGeometry(
          (p as any).width ?? 1.2,
          (p as any).height ?? 1.2,
          (p as any).depth ?? 1.2,
          64,
          64,
          64
        );
        break;
      case "plane":
        geometry = new THREE.PlaneGeometry(
          (p as any).width ?? 2.5,
          (p as any).height ?? 2.5,
          256,
          256
        );
        break;
      case "torus":
        geometry = new THREE.TorusGeometry(
          (p as any).radius ?? 0.9,
          (p as any).tube ?? 0.35,
          256,
          128
        );
        break;
      case "cylinder":
        geometry = new THREE.CylinderGeometry(
          (p as any).radiusTop ?? 0.8,
          (p as any).radiusBottom ?? 0.8,
          (p as any).height ?? 1.6,
          128,
          32
        );
        break;
      case "custom": {
        const g = makeCustomGeometry((recipe as any).customKind);
        geometry =
          g ?? new THREE.SphereGeometry((p as any).radius ?? 1.1, 256, 256);
        break;
      }
      case "sphere":
      default:
        geometry = new THREE.SphereGeometry((p as any).radius ?? 1.1, 256, 256);
        break;
    }

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

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // If GPT selected a custom metaphor, try to replace the fallback primitive with a Meshy-generated model
    const tryLoadMeshyModel = async () => {
      try {
        if (!props.spotifyId) return;
        // Allow runtime opt-out via env flag; if not set, still proceed by default
        const enable =
          (process.env.NEXT_PUBLIC_ENABLE_MESHY ?? "true").toLowerCase() !==
          "false";
        if (!enable) return;

        const promptRes = await fetch(`/api/visualizer/meshy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spotifyId: props.spotifyId,
            includeAnalysis: false,
          }),
        });
        if (!promptRes.ok) {
          setMeshyStatus(`meshy prompt error: ${promptRes.status}`);
          return;
        }
        const { prompt } = (await promptRes.json()) as { prompt?: string };
        if (!prompt) return;

        const startRes = await fetch(`/api/visualizer/meshy/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        if (!startRes.ok) {
          const txt = await startRes.text();
          setMeshyStatus(`meshy start error: ${startRes.status}`);
          console.warn("meshy start error", txt);
          return;
        }
        const startJson = (await startRes.json()) as { id?: string };
        if (!startJson.id) return;

        let modelUrl: string | null = null;
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const s = await fetch(
            `/api/visualizer/meshy/status?id=${encodeURIComponent(
              startJson.id!
            )}`,
            { cache: "no-store" }
          );
          if (!s.ok) continue;
          const j = (await s.json()) as {
            status?: string;
            model_url?: string;
            assets?: Array<{ url?: string }>;
          };
          setMeshyStatus(`meshy status: ${j.status ?? "pending"}`);
          if (j.model_url) {
            modelUrl = j.model_url;
            break;
          }
          if (Array.isArray((j as any).assets)) {
            const a = (j as any).assets.find(
              (x: any) => typeof x?.url === "string"
            );
            if (a?.url) {
              modelUrl = a.url as string;
              break;
            }
          }
          if (j.status && /failed|canceled/i.test(j.status)) break;
        }
        if (!modelUrl) return;

        if (!gltfLoaderRef.current) gltfLoaderRef.current = new GLTFLoader();
        const gltf = await new Promise<any>((resolve, reject) => {
          gltfLoaderRef.current!.load(modelUrl!, resolve, undefined, reject);
        });
        const root: THREE.Group = gltf.scene || gltf.scenes?.[0];
        if (!root) return;
        // Fit and center
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        root.position.sub(center);
        const scalar = 2.0 / Math.max(1e-3, Math.max(size.x, size.y, size.z));
        root.scale.multiplyScalar(scalar);
        // Apply our shader to every mesh so displacement still works
        root.traverse((obj) => {
          const m = obj as any;
          if (m.isMesh) {
            m.material = material;
            m.geometry.computeVertexNormals?.();
          }
        });
        // Swap the primitive with the GLTF root
        scene.add(root);
        scene.remove(mesh);
        mesh.geometry.dispose();
        setMeshyStatus(null);
      } catch {
        // ignore and keep fallback primitive
        setMeshyStatus((prev) => prev ?? "meshy failed — using fallback");
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
      if (analyser && fftArray && recipe) {
        try {
          analyser.getByteFrequencyData(
            fftArray as unknown as Uint8Array<ArrayBuffer>
          );
        } catch {}
        const lowIdx = recipe.audioMapping?.fftBands?.low ?? 2;
        const midIdx = recipe.audioMapping?.fftBands?.mid ?? 24;
        const highIdx = recipe.audioMapping?.fftBands?.high ?? 96;
        const low = (fftArray as Uint8Array)[lowIdx] ?? 0;
        const mid = (fftArray as Uint8Array)[midIdx] ?? 0;
        const high = (fftArray as Uint8Array)[highIdx] ?? 0;
        const energy = (low + mid + high) / (3 * 255);
        const baseAmp = (recipe.deformation as any)?.amplitude ?? 0.3;
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
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", onResize);
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [recipe, analyser, fftArray, spotifyScalar]);

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

  if (!recipe) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        {/* 3D Visualizer Area - Top */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "radial-gradient(60% 60% at 50% 20%, rgba(80,38,125,0.45) 0%, rgba(18,12,24,0.85) 48%, #07070a 100%)",
            position: "relative",
          }}
        >
          <div style={{ 
            color: "#9aa0a6", 
            textAlign: "center",
            padding: "24px",
            background: "rgba(14,14,18,0.5)",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.08)"
          }}>
            Loading visualizer...
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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
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
            width: "100%",
            height: "100%",
            display: "block"
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
