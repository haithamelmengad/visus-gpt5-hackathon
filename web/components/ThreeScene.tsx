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
    scene.background = new THREE.Color(0x0b0b0b);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 3;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
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
    const hasTrap = lower.includes("trap");
    const hasQueen = lower.includes("queen");

    // Procedural model informed by imagery keywords
    const buildFromKeywords = () => {
      const group = new THREE.Group();
      // Trap ring (bear trap)
      if (hasTrap) {
        const ringMat = new THREE.MeshStandardMaterial({ color: 0x9999aa, metalness: 0.7, roughness: 0.3 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 24, 180), ringMat);
        group.add(ring);
        // Teeth
        const teethMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.5 });
        const toothGeo = new THREE.ConeGeometry(0.08, 0.22, 8);
        const teeth = lower.includes("queen") ? 24 : 18;
        for (let i = 0; i < teeth; i++) {
          const a = (i / teeth) * Math.PI * 2;
          const x = Math.cos(a) * 0.94;
          const y = Math.sin(a) * 0.94;
          const tooth = new THREE.Mesh(toothGeo, teethMat);
          tooth.position.set(x, y, 0);
          tooth.lookAt(0, 0, 0);
          group.add(tooth);
        }
      }
      // Crown
      if (hasQueen) {
        const gold = new THREE.MeshStandardMaterial({ color: 0xdaa520, metalness: 0.8, roughness: 0.25 });
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 16, 120), gold);
        band.position.z = 0.1;
        band.rotation.x = Math.PI / 2;
        group.add(band);

        const spikeGeo = new THREE.ConeGeometry(0.09, 0.35, 12);
        const spikes = 8;
        for (let i = 0; i < spikes; i++) {
          const a = (i / spikes) * Math.PI * 2;
          const x = Math.cos(a) * 0.6;
          const z = Math.sin(a) * 0.6;
          const spike = new THREE.Mesh(spikeGeo, gold);
          spike.position.set(x, 0.0, z);
          spike.rotation.x = -Math.PI / 2;
          spike.lookAt(x, 1, z);
          group.add(spike);
        }
        // Jewel
        const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshStandardMaterial({ color: 0x8a2be2, emissive: 0x220044 }));
        jewel.position.set(0, 0.25, 0.0);
        group.add(jewel);
      }

      // Butterfly
      if (lower.includes("butterfly")) {
        const wingMat = new THREE.MeshStandardMaterial({ color: 0x8a2be2, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.85 });
        const makeWing = (sign: number) => {
          const s = new THREE.Shape();
          s.moveTo(0, 0);
          s.bezierCurveTo(0.4, 0.2, 0.9, 0.5, 1.0, 1.1);
          s.bezierCurveTo(0.9, 1.6, 0.4, 1.8, 0.1, 1.2);
          s.bezierCurveTo(0.0, 0.9, 0.1, 0.4, 0, 0);
          const g = new THREE.ShapeGeometry(s, 48);
          g.rotateZ(sign < 0 ? Math.PI : 0);
          const m = new THREE.Mesh(g, wingMat);
          m.scale.set(sign, 1, 1);
          m.position.set(0.15 * sign, 0.1, 0);
          return m;
        };
        const left = makeWing(-1);
        const right = makeWing(1);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.1 }));
        body.rotation.z = Math.PI / 2;
        body.position.set(0, 0.6, 0);
        group.add(left, right, body);

        // Spiral trail for "effect"
        if (lower.includes("effect")) {
          const pts: THREE.Vector3[] = [];
          const turns = 3;
          for (let i = 0; i < 200; i++) {
            const t = (i / 200) * turns * Math.PI * 2;
            const r = 0.2 + i * 0.0025;
            pts.push(new THREE.Vector3(Math.cos(t) * r, -0.2 + i * 0.004, Math.sin(t) * r));
          }
          const curve = new THREE.CatmullRomCurve3(pts);
          const tube = new THREE.TubeGeometry(curve, 200, 0.01, 8, false);
          const trail = new THREE.Mesh(tube, new THREE.MeshStandardMaterial({ color: 0x8a2be2, emissive: 0x220044 }));
          group.add(trail);
        }
      }

      // Heart
      if (/(love|heart)/.test(lower)) {
        const x = 0, y = 0;
        const heartShape = new THREE.Shape();
        heartShape.moveTo(x + 0, y + 0.5);
        heartShape.bezierCurveTo(x + 0, y + 0.8, x - 0.6, y + 0.8, x - 0.6, y + 0.5);
        heartShape.bezierCurveTo(x - 0.6, y + 0.2, x - 0.2, y + 0.1, x + 0, y - 0.1);
        heartShape.bezierCurveTo(x + 0.2, y + 0.1, x + 0.6, y + 0.2, x + 0.6, y + 0.5);
        heartShape.bezierCurveTo(x + 0.6, y + 0.8, x + 0, y + 0.8, x + 0, y + 0.5);
        const geo = new THREE.ExtrudeGeometry(heartShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.04, bevelSegments: 2 });
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xff2d55, metalness: 0.1, roughness: 0.6 }));
        mesh.rotation.x = -Math.PI / 2;
        group.add(mesh);
      }

      if (group.children.length > 0) {
        scene.add(group);
        meshRef.current = group;
        return true;
      }
      return false;
    };

    // Default: generate a unique seed-based sculpture using a superformula lathe profile
    const buildDefaultSculpt = () => {
      const h0 = h;
      const rnd = (k: number, min: number, max: number) => min + ((h0 >> k) % 1000) / 1000 * (max - min);
      // Superformula parameters (2D)
      const a = 1;
      const b = 1;
      const m = Math.floor(rnd(2, 3, 12));
      const n1 = rnd(4, 0.2, 1.8);
      const n2 = rnd(6, 0.2, 1.8);
      const n3 = rnd(8, 0.2, 1.8);
      const superformula = (phi: number) => {
        const c1 = Math.pow(Math.abs(Math.cos(m * phi / 4) / a), n2);
        const c2 = Math.pow(Math.abs(Math.sin(m * phi / 4) / b), n3);
        const r = Math.pow(c1 + c2, -1 / n1);
        return r;
      };
      const points: THREE.Vector2[] = [];
      const steps = 128;
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI; // 0..PI upper half profile
        const r = superformula(t);
        const x = r * 0.9 + 0.05 * Math.sin(i * 0.3);
        const y = (i / steps) * 1.6 - 0.8;
        points.push(new THREE.Vector2(Math.max(0.01, x), y));
      }
      const geom = new THREE.LatheGeometry(points, 256);
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      scene.add(mesh);
      meshRef.current = mesh;
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

    if (!buildFromKeywords()) {
      if (!buildDefaultSculpt()) {
        void buildText();
      }
    }
  }, [seed]);

  return <div ref={containerRef} style={{ width: "100%", marginTop: 24 }} />;
}


