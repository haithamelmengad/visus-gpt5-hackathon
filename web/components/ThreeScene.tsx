"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function ThreeScene({ level = 0, isPlaying = false }: { level?: number; isPlaying?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelRef = useRef<number>(0);
  const playingRef = useRef<boolean>(false);
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

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 3;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.4, metalness: 0.2 });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);

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
      if (playingRef.current) {
        cube.rotation.x += 0.01;
        cube.rotation.y += 0.02;
      }
      // Map level (0..1) to a pleasant scale range and smooth it a bit
      const target = 1 + Math.min(1, Math.max(0, levelRef.current)) * 0.8;
      displayedScale += (target - displayedScale) * 0.2; // simple easing
      cube.scale.setScalar(displayedScale);
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} style={{ width: "100%", marginTop: 24 }} />;
}


