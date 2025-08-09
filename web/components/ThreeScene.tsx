"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";

type Props = { level?: number; isPlaying?: boolean; seed?: string };

export default function ThreeScene({ level = 0, isPlaying = false, seed = "" }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelRef = useRef<number>(0);
  const playingRef = useRef<boolean>(false);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshRef = useRef<THREE.Object3D | null>(null);
  // Keep latest level available to the animation loop without re-creating the scene
  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const container = containerRef.current!;
    const width = container.clientWidth || 600;
    const height = 360;

    const scene = new THREE.Scene();
    // Transparent background so the page gradient shows through
    scene.background = null;
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 3;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(2, 3, 4);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    const onResize = () => {
      const w = container.clientWidth || width;
      const h = height;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    let displayedScale = 1;
    const animate = () => {
      const mesh = meshRef.current;
      if (mesh && playingRef.current) {
        mesh.rotation.x += 0.01;
        mesh.rotation.y += 0.02;
      }
      // Map level (0..1) to a pleasant scale range and smooth it a bit
      const target = 1 + Math.min(1, Math.max(0, levelRef.current)) * 0.8;
      displayedScale += (target - displayedScale) * 0.2; // simple easing
      if (mesh) mesh.scale.setScalar(displayedScale);
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
      renderer.dispose();
      if (meshRef.current) {
        meshRef.current.traverse((child) => {
          const m = child as any;
          if (m.geometry) m.geometry.dispose?.();
          if (m.material) {
            if (Array.isArray(m.material)) m.material.forEach((mat: THREE.Material) => mat.dispose());
            else (m.material as THREE.Material).dispose?.();
          }
        });
      }
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Create or update the mesh when seed changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove previous
    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.traverse((child) => {
        const m = child as any;
        if (m.geometry) m.geometry.dispose?.();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mat: THREE.Material) => mat.dispose());
          else (m.material as THREE.Material).dispose?.();
        }
      });
      meshRef.current = null;
    }

    // Hash the seed into deterministic parameters
    const hash = (s: string) => {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    const h = hash(seed || "model");
    const pick = (min: number, max: number, k: number) => min + ((h >> k) % 1000) / 1000 * (max - min);
    const variant = h % 4;

    const color = new THREE.Color().setHSL(((h >> 8) % 360) / 360, 0.6, 0.55);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 });

    const lower = (seed || "").toLowerCase();

    // Dynamic seed-driven generator (no hardcoded keywords)
    const buildProceduralSculpt = () => {
      const group = new THREE.Group();

      // Helper: fit model into view and center it
      const fitAndCenter = (obj: THREE.Object3D) => {
        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);
        obj.position.sub(center);
        const maxDim = Math.max(size.x, size.y, size.z);
        const desired = 1.6;
        const scale = maxDim > 0 ? desired / maxDim : 1;
        obj.scale.multiplyScalar(scale);
      };

      // Derive statistical features from the seed
      const words = lower.trim().split(/\s+/).filter(Boolean);
      const seedLength = lower.length;
      const wordCount = Math.max(1, words.length);
      const uniqueChars = new Set(lower.replace(/\s+/g, "").split("")).size;
      const vowelCount = (lower.match(/[aeiou]/g) || []).length;
      const digitCount = (lower.match(/\d/g) || []).length;
      const specialCount = (lower.match(/[^\w\s]/g) || []).length;
      const vowelRatio = seedLength > 0 ? vowelCount / seedLength : 0.3;
      const uniqueness = seedLength > 0 ? uniqueChars / Math.min(26, seedLength) : 0.5;

      // Small PRNG for repeatable variation beyond bit shifts
      let s = h >>> 0;
      const rndUnit = () => {
        s = (s * 1664525 + 1013904223) >>> 0; // LCG
        return s / 0xffffffff;
      };
      const rndRange = (min: number, max: number) => min + rndUnit() * (max - min);

      // Base profile: superformula with parameters informed by text features
      const a = 1, b = 1;
      const m = Math.max(3, Math.round(3 + uniqueness * 9));
      const n1 = 0.3 + vowelRatio * 1.7;
      const n2 = 0.3 + rndRange(0.3, 1.8);
      const n3 = 0.3 + rndRange(0.3, 1.8);
      const superformula = (phi: number) => {
        const c1 = Math.pow(Math.abs(Math.cos((m * phi) / 4) / a), n2);
        const c2 = Math.pow(Math.abs(Math.sin((m * phi) / 4) / b), n3);
        return Math.pow(c1 + c2, -1 / n1);
      };

      // Build a lathe from a modulated profile; ripples driven by word count and digits
      const points: THREE.Vector2[] = [];
      const steps = 160;
      const rippleCount = Math.max(1, Math.min(20, wordCount + digitCount));
      const twistAmount = (specialCount * 0.15) + rndRange(0, 0.15);
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI;
        const r = superformula(t);
        const ripple = 0.06 * Math.sin((i / steps) * rippleCount * Math.PI * 2);
        const x = Math.max(0.01, r * 0.9 + ripple);
        const y = (i / steps) * 1.6 - 0.8;
        points.push(new THREE.Vector2(x, y));
      }
      const bodyGeom = new THREE.LatheGeometry(points, 256);

      // Apply a gentle vertical twist based on special character count
      const pos = bodyGeom.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const angle = vy * twistAmount;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rx = vx * cos - vz * sin;
        const rz = vx * sin + vz * cos;
        pos.setX(i, rx);
        pos.setZ(i, rz);
      }
      bodyGeom.computeVertexNormals();
      const body = new THREE.Mesh(bodyGeom, material);
      group.add(body);

      // Add ring accents based on word count
      const ringCount = Math.min(6, Math.max(0, wordCount - 1));
      for (let i = 0; i < ringCount; i++) {
        const t = -0.6 + (i + 1) * (1.2 / (ringCount + 1));
        const radius = 0.55 + rndRange(-0.08, 0.12);
        const tube = 0.02 + 0.02 * rndUnit();
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 16, 120), material);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = t;
        group.add(ring);
      }

      // Add spikes influenced by consonant dominance
      const consonantRatio = seedLength > 0 ? (seedLength - vowelCount) / seedLength : 0.7;
      const spikeBands = Math.round(consonantRatio * 2);
      const spikesPerBand = Math.round(8 + uniqueness * 12);
      for (let bnd = 0; bnd < spikeBands; bnd++) {
        const y = -0.3 + bnd * 0.3;
        const spikeGeo = new THREE.ConeGeometry(0.05 + 0.03 * rndUnit(), 0.18 + 0.12 * rndUnit(), 10);
        for (let i = 0; i < spikesPerBand; i++) {
          const a2 = (i / spikesPerBand) * Math.PI * 2;
          const r2 = 0.6 + 0.1 * rndUnit();
          const spike = new THREE.Mesh(spikeGeo, material);
          spike.position.set(Math.cos(a2) * r2, y, Math.sin(a2) * r2);
          spike.lookAt(0, y, 0);
          group.add(spike);
        }
      }

      // Sprinkle small gems/particles based on special characters
      const gems = Math.min(80, 10 + specialCount * 14);
      const gemMat = new THREE.MeshStandardMaterial({ color: color.clone().offsetHSL(0.05, 0, 0).getHex(), emissive: new THREE.Color(color).multiplyScalar(0.15) });
      for (let i = 0; i < gems; i++) {
        const r = 0.04 + 0.02 * rndUnit();
        const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), gemMat);
        const th = rndUnit() * Math.PI * 2;
        const ph = (rndUnit() - 0.5) * Math.PI * 0.8;
        const R = 0.9 + 0.4 * rndUnit();
        gem.position.set(Math.cos(th) * Math.cos(ph) * R, Math.sin(ph) * R * 0.6, Math.sin(th) * Math.cos(ph) * R);
        group.add(gem);
      }

      fitAndCenter(group);
      scene.add(group);
      meshRef.current = group;
      return true;
    };

    // Try text geometry if everything else fails
    const buildText = async () => {
      try {
        const loader = new FontLoader();
        const font = await new Promise<any>((resolve, reject) => {
          loader.load(
            "https://threejs.org/examples/fonts/helvetiker_regular.typeface.json",
            resolve,
            undefined,
            reject
          );
        });

        const label = (seed || "").slice(0, 18); // limit length
        const textGeo = new TextGeometry(label, {
          font,
          size: 0.5,
          depth: 0.15,
          curveSegments: 8,
          bevelEnabled: true,
          bevelThickness: 0.02,
          bevelSize: 0.01,
          bevelSegments: 2,
        });
        textGeo.computeBoundingBox();
        const bbox = textGeo.boundingBox!;
        const centerX = (bbox.max.x - bbox.min.x) / 2;
        const centerY = (bbox.max.y - bbox.min.y) / 2;
        textGeo.translate(-centerX, -centerY, 0);

        const textMesh = new THREE.Mesh(textGeo, material);
        scene.add(textMesh);
        meshRef.current = textMesh;
      } catch {
        // Fallback to procedural geometry
        let geometry: THREE.BufferGeometry;
        switch (variant) {
          case 0:
            geometry = new THREE.TorusKnotGeometry(pick(0.8, 1.2, 0), pick(0.2, 0.5, 10), 200, 16, Math.floor(pick(1, 4, 20)), Math.floor(pick(1, 8, 24)));
            break;
          case 1:
            geometry = new THREE.IcosahedronGeometry(pick(0.9, 1.3, 4), 1);
            break;
          case 2:
            geometry = new THREE.DodecahedronGeometry(pick(0.9, 1.3, 8), 0);
            break;
          default:
            geometry = new THREE.TorusGeometry(pick(0.8, 1.4, 12), pick(0.15, 0.45, 16), 24, 180);
        }
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
        meshRef.current = mesh;
      }
    };

    if (!buildProceduralSculpt()) {
      void buildText();
    }
  }, [seed]);

  return <div ref={containerRef} style={{ width: "100%", marginTop: 24 }} />;
}


