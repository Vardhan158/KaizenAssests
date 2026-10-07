import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { JourneyStage } from "./data/journeyStages";

interface JourneyCameraProps {
  stages: JourneyStage[];
  scrollProgress: number; // 0 to 1
  overviewProgress?: number;
  mouseOffset: { x: number; y: number };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

function smoothstep(min: number, max: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

// Precision camera waypoints that guarantee the truck is always in full view
const CAMERA_KEYFRAMES: {
  p: number;
  pos: [number, number, number];
  target: [number, number, number];
}[] = [
  // 1. Stage 1: Gate Entry approach - Gate arm rises UP, truck moves forward (p = 0.00)
  // Positioned backward to give an expansive full view of the warehouse front facade, compound, and inbound truck
  { p: 0.0, pos: [-8.2, 5.6, 34.8], target: [0.4, 2.8, 14.5] },
  // 2. Tracking truck passing under raised gate arm (p = 0.035)
  { p: 0.035, pos: [-7.0, 5.0, 29.2], target: [0.5, 2.2, 12.0] },
  // 3. Tracking truck through portal into warehouse (p = 0.070)
  { p: 0.07, pos: [-4.8, 4.2, 16.5], target: [0.0, 1.8, 6.0] },
  // 4. Following truck into warehouse apron setup (p = 0.105)
  { p: 0.105, pos: [7.0, 6.5, 2.0], target: [-1.0, 1.8, -9.0] },
  // 5. Viewing truck shift into reverse & back into dock (p = 0.135)
  { p: 0.135, pos: [5.0, 6.5, -2.0], target: [-5.5, 1.8, -13.0] },
  // 6. Stage 2: GRN Dock 02 - Truck parked, doors open (p = 0.1667)
  { p: 0.1667, pos: [1.0, 5.5, -17.0], target: [-8.0, 1.8, -21.5] },
  // 6a. Dock Inspector checking goods list manifest & scanning cartons (p = 0.200)
  { p: 0.2, pos: [-3.5, 3.2, -20.5], target: [-7.2, 1.8, -23.8] },
  // 6b. Goods list verified & released - Forklift approaches dock and slides forks under pallet (p = 0.240)
  { p: 0.24, pos: [-1.8, 3.8, -19.0], target: [-8.0, 1.6, -24.5] },
  // 6c. Forklift lifts pallet off dock platform & backs out into turn area (p = 0.275)
  { p: 0.275, pos: [-0.5, 3.8, -24.0], target: [-6.5, 1.6, -30.0] },
  // 6d. Forklift turns and enters high-bay storage aisle (p = 0.315)
  { p: 0.315, pos: [-3.0, 3.6, -36.0], target: [0.0, 1.6, -50.0] },
  // 6e. Forklift cruising down storage aisle toward destination (p = 0.345)
  { p: 0.345, pos: [-4.0, 3.6, -56.0], target: [3.5, 1.6, -68.0] },
  // 7. Stage 3: Store / Putaway - Forklift turning to face Right Storage Rack (p = 0.365)
  { p: 0.365, pos: [-4.5, 3.4, -63.0], target: [5.5, 2.0, -68.0] },
  // 7a. Forklift elevates mast and slots pallet squarely into Bin 01 (p = 0.390)
  { p: 0.39, pos: [2.0, 4.2, -62.0], target: [8.0, 2.0, -68.0] },
  // 7b. Putaway complete, barcode verified, overview of stocked rack (p = 0.420)
  { p: 0.42, pos: [0.0, 5.0, -60.0], target: [8.0, 2.0, -68.0] },
  // 8. Stage 4: High Inventory Matrix Overview (p = 0.5000)
  { p: 0.5, pos: [-1.0, 7.0, -57.0], target: [8.0, 2.0, -68.0] },
  // 9. Stage 5: Robotic Assembly Station (p = 0.6667)
  { p: 0.6667, pos: [-6.8, 3.6, -157.0], target: [0.1, 1.6, -165.0] },
  // 10. Stage 6: Outbound Dispatch Loading Bay (p = 0.8333)
  { p: 0.8333, pos: [8.0, 4.0, -202.0], target: [-3.0, 2.0, -212.0] },
  // 11. Stage 7: Departure Gate Exit (p = 1.0000)
  { p: 1.0, pos: [-7.0, 4.2, -240.0], target: [1.0, 2.0, -255.0] },
];

export function JourneyCamera({
  stages: _stages,
  scrollProgress,
  overviewProgress = 1,
  mouseOffset,
}: JourneyCameraProps) {
  const { camera, scene, size } = useThree();
  const initialized = useRef(false);
  const scratch = useMemo(
    () => ({
      position: new THREE.Vector3(),
      target: new THREE.Vector3(),
      front: new THREE.Vector3(),
      frontTarget: new THREE.Vector3(0, 4.8, 10),
    }),
    [],
  );
  const pointer = useRef({ x: 0, y: 0 });
  const currentLookAt = useRef(new THREE.Vector3(0.4, 2.8, 14.5));

  useFrame((_, delta) => {
    const p = clamp(scrollProgress, 0, 1);

    // Find the bounding keyframe segment
    let idx = 0;
    for (let i = 0; i < CAMERA_KEYFRAMES.length - 1; i++) {
      if (p >= CAMERA_KEYFRAMES[i].p && p <= CAMERA_KEYFRAMES[i + 1].p) {
        idx = i;
        break;
      }
    }
    const k1 = CAMERA_KEYFRAMES[idx];
    const k2 = CAMERA_KEYFRAMES[idx + 1];
    const t = smoothstep(k1.p, k2.p, p);

    const desiredPos = scratch.position.set(
      lerp(k1.pos[0], k2.pos[0], t),
      lerp(k1.pos[1], k2.pos[1], t),
      lerp(k1.pos[2], k2.pos[2], t),
    );

    const desiredTarget = scratch.target.set(
      lerp(k1.target[0], k2.target[0], t),
      lerp(k1.target[1], k2.target[1], t),
      lerp(k1.target[2], k2.target[2], t),
    );

    // ─── STARTING VIEW: WAREHOUSE FRONT FULL VIEW OVERVIEW ───
    // Expansive framing capturing the triangular peaked roof, front facade, entry portal, and approach
    const warehouseFrontTarget = scratch.frontTarget;
    const overviewHeight = clamp(17.5 * (size.width < 768 ? 1.25 : 1.0), 16.0, 24.0);
    const warehouseFrontPos = scratch.front.set(-6.5, overviewHeight, 43.5);

    // Smooth ease-in-out cubic curve for natural descent from full front view to gate entry
    const easeInOutCubic = (val: number) =>
      val < 0.5 ? 4 * val * val * val : 1 - Math.pow(-2 * val + 2, 3) / 2;

    const approach = easeInOutCubic(clamp(overviewProgress, 0, 1));

    // When overviewProgress is 0: camera is at the warehouse front full view.
    // When overviewProgress -> 1: camera glides down and tilts into Gate Entry checkpoint.
    desiredPos.lerp(warehouseFrontPos, 1 - approach);
    desiredTarget.lerp(warehouseFrontTarget, 1 - approach);

    const pointerSmoothing = 1 - Math.exp(-12 * Math.min(delta, 0.1));
    pointer.current.x += (mouseOffset.x - pointer.current.x) * pointerSmoothing;
    pointer.current.y += (mouseOffset.y - pointer.current.y) * pointerSmoothing;
    // Apply gentle mouse parallax
    desiredPos.x += pointer.current.x * 0.45 * approach;
    desiredPos.y += pointer.current.y * 0.35 * approach;

    const smoothing = 1 - Math.exp(-12 * Math.min(delta, 0.1));
    if (!initialized.current) {
      camera.position.copy(desiredPos);
      currentLookAt.current.copy(desiredTarget);
      initialized.current = true;
    } else {
      camera.position.lerp(desiredPos, smoothing);
      currentLookAt.current.lerp(desiredTarget, smoothing);
    }
    camera.lookAt(currentLookAt.current);

    if (scene.fog instanceof THREE.Fog) {
      // Keep fog crisp for the front facade and compound while softly veiling distant interior
      scene.fog.near = lerp(65, 45, approach);
      scene.fog.far = lerp(350, 280, approach);
    }
  });

  return null;
}
