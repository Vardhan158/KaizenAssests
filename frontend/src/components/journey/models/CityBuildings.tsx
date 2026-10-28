import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type Part = { position: [number, number, number]; scale: [number, number, number]; color: string };

// Shared box geometry keeps thousands of facade details to three draw calls.
function BuildingParts({
  parts,
  glass = false,
  lit = false,
}: {
  parts: Part[];
  glass?: boolean;
  lit?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    parts.forEach((part, index) => {
      transform.position.set(...part.position);
      transform.scale.set(...part.scale);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, color.set(part.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [parts]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, parts.length]}
      castShadow={!glass}
      receiveShadow
    >
      <boxGeometry />
      {lit ? (
        <meshBasicMaterial toneMapped />
      ) : (
        <meshStandardMaterial roughness={glass ? 0.24 : 0.82} metalness={glass ? 0.45 : 0.08} />
      )}
    </instancedMesh>
  );
}

function StreetLights() {
  const positions = [-30, 0, 30].flatMap((z) => [
    [-108, z],
    [108, z],
  ]);
  return (
    <>
      {positions.map(([x, z]) => (
        <group key={`${x}-${z}`} position={[x, 0, z]}>
          <mesh position={[0, 2.2, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.09, 4.4, 8]} />
            <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[x < 0 ? 0.38 : -0.38, 4.35, 0]} rotation={[0, 0, x < 0 ? -0.35 : 0.35]}>
            <boxGeometry args={[0.8, 0.08, 0.08]} />
            <meshStandardMaterial color="#475569" />
          </mesh>
          <mesh position={[x < 0 ? 0.72 : -0.72, 4.22, 0]}>
            <sphereGeometry args={[0.16, 12, 8]} />
            <meshStandardMaterial color="#fef3c7" emissive="#fbbf24" emissiveIntensity={2.2} />
          </mesh>
        </group>
      ))}
    </>
  );
}

export function CityBuildings() {
  const batches = useMemo(() => {
    const solid: Part[] = [],
      glass: Part[] = [],
      lit: Part[] = [];
    const add = (
      parts: Part[],
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: string,
    ) => parts.push({ position: [x, y, z], scale: [w, h, d], color });
    const finishes = ["#64748b", "#475569", "#3f5368", "#334155"];
    const asphalt = "#30383f",
      pavement = "#a4aaa9",
      marking = "#e5e1ce";
    // Outer avenues connect the cross streets without crossing the warehouse.
    for (const side of [-1, 1]) {
      add(solid, side * 112, -0.06, -164, 8, 0.1, 432, asphalt);
      add(solid, side * 118, 0.04, -164, 4, 0.3, 432, pavement);
      for (let row = 0; row < 15; row++) {
        const streetZ = 22 - row * 27;
        add(solid, side * 78, -0.055, streetZ, 76, 0.1, 6, asphalt);
        // Pavements terminate before the avenue intersection.
        for (const edge of [-1, 1])
          add(solid, side * 74, 0.04, streetZ + edge * 4, 68, 0.3, 2, pavement);
        for (let dash = 44; dash < 106; dash += 7)
          add(solid, side * dash, 0.004, streetZ, 3, 0.015, 0.12, marking);
        // Pedestrian crossing at each avenue junction.
        for (let stripe = 0; stripe < 6; stripe++)
          add(solid, side * 104, 0.004, streetZ - 2.5 + stripe, 2, 0.015, 0.45, marking);
      }
      for (let z = -372; z < 48; z += 6) {
        const atJunction = Array.from({ length: 15 }, (_, row) => 22 - row * 27).some(
          (junction) => Math.abs(z - junction) < 5,
        );
        if (!atJunction) add(solid, side * 112, 0.004, z, 0.12, 0.015, 3, marking);
      }
    }
    // Front and rear links join both sides beyond the facility footprint.
    for (const z of [52, -380]) {
      add(solid, 0, -0.055, z, 232, 0.1, 8, asphalt);
      add(solid, 0, 0.04, z + (z > 0 ? 6 : -6), 240, 0.3, 4, pavement);
      for (let x = -102; x <= 102; x += 6) add(solid, x, 0.004, z, 3, 0.015, 0.12, marking);
    }
    for (let i = 0; i < 30; i++) {
      // The first building is the supplier facility and stays with the
      // supplier truck at the far-side journey starting point.
      const x = i === 0 ? -96 : (i % 2 ? 1 : -1) * (48 + (i % 5) * 12);
      const z = 12 - Math.floor(i / 2) * 27;
      const w = 7 + (i % 4) * 2,
        d = 8 + (i % 3) * 2;
      const floors = 3 + ((i * 7) % 8),
        h = floors * 3.2;
      const finish = finishes[i % finishes.length] ?? "#475569";
      add(solid, x, h / 2, z, w, h, d, finish);
      // Raised pavement, dark ground-floor lobby and entrance canopy.
      add(solid, x, 0.04, z, w + 3, 0.3, d + 3, "#a4aaa9");
      // Connect every lobby pavement to its street-side sidewalk.
      const walkStart = z + (d + 3) / 2;
      const walkEnd = z + 7;
      if (walkEnd > walkStart)
        add(solid, x, 0.04, (walkStart + walkEnd) / 2, 3, 0.3, walkEnd - walkStart, pavement);
      add(glass, x, 1.55, z + d / 2 + 0.05, w - 0.6, 2.6, 0.12, "#0ea5e9");
      add(solid, x, 2.8, z + d / 2 + 0.8, 3.6, 0.18, 1.8, "#343f47");
      add(solid, x, 1.4, z + d / 2 + 0.13, 0.08, 2.5, 0.12, "#aeb8bd");
      for (let f = 1; f < floors; f++) {
        const y = f * 3.2 + 1.5;
        add(solid, x, f * 3.2, z, w + 0.16, 0.16, d + 0.16, "#c6c8c5");
        for (const side of [-1, 1]) {
          // Framed, individually shaded windows on all four elevations.
          for (let c = 0; c < Math.floor(w / 2); c++) {
            const wx = x - w / 2 + 1.1 + c * 2;
            const light = (i * 13 + f * 5 + c * 3 + side) % 11 === 0;
            add(solid, wx, y, z + side * (d / 2 + 0.06), 1.55, 2.15, 0.15, "#38434b");
            add(
              light ? lit : glass,
              wx,
              y,
              z + side * (d / 2 + 0.15),
              1.32,
              1.9,
              0.04,
              light ? "#c5ad80" : "#526b77",
            );
          }
          for (let c = 0; c < Math.floor(d / 2); c++) {
            const wz = z - d / 2 + 1.1 + c * 2;
            add(solid, x + side * (w / 2 + 0.06), y, wz, 0.15, 2.15, 1.55, "#38434b");
            add(glass, x + side * (w / 2 + 0.15), y, wz, 0.04, 1.9, 1.32, "#38bdf8");
          }
        }
      }
      // Roof coping and mechanical equipment give the aerial view detail.
      add(solid, x, h + 0.12, z, w + 0.3, 0.24, d + 0.3, "#b9bfbd");
      add(solid, x, h + 0.26, z, w - 0.5, 0.12, d - 0.5, "#444c52");
      add(solid, x - w * 0.18, h + 0.85, z, 2.2, 1.2, 2.5, "#899498");
      for (let vent = 0; vent < 5; vent++)
        add(solid, x - w * 0.18, h + 1.47, z - 0.9 + vent * 0.45, 1.9, 0.05, 0.12, "#354149");
    }
    return { solid, glass, lit };
  }, []);
  return (
    <group>
      <BuildingParts parts={batches.solid} />
      <BuildingParts parts={batches.glass} glass />
      <BuildingParts parts={batches.lit} glass lit />
      <StreetLights />
    </group>
  );
}
