import * as THREE from "three";

/**
 * Three.js utilities for common operations
 */

export interface DisplacementModifier {
  time: number;
  amplitude: number;
  apply: (time: number, amplitude: number) => void;
}

export const createMeshDisplacementModifier = (
  mesh: THREE.Mesh,
  originalGeometry: THREE.BufferGeometry
): DisplacementModifier => {
  return {
    time: 0,
    amplitude: 0,
    apply: (time: number, amplitude: number) => {
      const positions = originalGeometry.attributes.position.array;
      const normals = originalGeometry.attributes.normal.array;

      // Create a new geometry with displacement
      const newGeo = originalGeometry.clone();
      const newPositions = newGeo.attributes.position.array;

      // Smooth noise function for uniform distortion
      const smoothNoise = (x: number, y: number, z: number, time: number) => {
        // Generate smooth noise values using sine waves for uniformity
        const noiseX = Math.sin(x * 0.5 + time * 0.1) * 0.5 + 0.5;
        const noiseY = Math.sin(y * 0.5 + time * 0.08) * 0.5 + 0.5;
        const noiseZ = Math.sin(z * 0.5 + time * 0.12) * 0.5 + 0.5;

        // Combine with smooth interpolation
        return (noiseX + noiseY + noiseZ) / 3;
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
      mesh.geometry.dispose();
      mesh.geometry = newGeo;
    },
  };
};

export const fitAndCenterObject = (
  object: THREE.Object3D,
  desiredSize = 2.6
): number => {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  object.position.sub(center);

  const currentMaxSize = Math.max(1e-3, Math.max(size.x, size.y, size.z));
  const scalar = desiredSize / currentMaxSize;
  object.scale.multiplyScalar(scalar);

  return scalar;
};

export const disposeObject = (object: THREE.Object3D): void => {
  object.traverse((child) => {
    const meshChild = child as THREE.Object3D & { isMesh?: boolean };
    if (meshChild.isMesh) {
      const realMesh = meshChild as unknown as THREE.Mesh;
      realMesh.geometry?.dispose?.();
      const mat = realMesh.material as
        | THREE.Material
        | THREE.Material[]
        | undefined;
      if (Array.isArray(mat)) {
        mat.forEach((mm) => mm?.dispose?.());
      } else {
        mat?.dispose?.();
      }
    }
  });
};

export const createEnhancedLighting = (scene: THREE.Scene): void => {
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

  scene.add(enhancedAmb);
  scene.add(enhancedDirLight);
  scene.add(rimLight);
  scene.add(fillLight);
};
