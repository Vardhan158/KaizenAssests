import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { JourneyStage } from "./data/journeyStages";
import { supplierJourney } from "./supplierJourney";

interface JourneyCameraProps {
  stages: JourneyStage[];
  scrollProgress: number; // 0 to 1
  overviewProgress?: number;
  supplierProgress?: number;
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

export function JourneyCamera({
  stages,
  scrollProgress,
  overviewProgress = 1,
  supplierProgress = 1,
  mouseOffset,
}: JourneyCameraProps) {
  const { camera, scene, size } = useThree();
  const initialized = useRef(false);

  const keyframes = useMemo(() => {
    if (!stages || stages.length === 0) return [];
    const count = stages.length;
    return stages.map((stg, i) => ({
      p: count > 1 ? i / (count - 1) : 0,
      pos: stg.cameraPosition,
      target: stg.cameraTarget,
    }));
  }, [stages]);

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
  const currentLookAt = useRef(new THREE.Vector3(0.8, 1.8, 23.0));

  useFrame((_, delta) => {
    if (!keyframes || keyframes.length < 2) return;

    const p = clamp(scrollProgress, 0, 1);

    // Find the bounding keyframe segment
    let idx = 0;
    for (let i = 0; i < keyframes.length - 1; i++) {
      if (p >= keyframes[i].p && p <= keyframes[i + 1].p) {
        idx = i;
        break;
      }
    }
    const k1 = keyframes[idx];
    const k2 = keyframes[idx + 1] || k1;
    const t = k2.p > k1.p ? smoothstep(k1.p, k2.p, p) : 0;

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
    const warehouseFrontTarget = scratch.frontTarget;
    const overviewHeight = clamp(17.5 * (size.width < 768 ? 1.25 : 1.0), 16.0, 24.0);
    const warehouseFrontPos = scratch.front.set(-6.5, overviewHeight, 43.5);

    const easeInOutCubic = (val: number) =>
      val < 0.5 ? 4 * val * val * val : 1 - Math.pow(-2 * val + 2, 3) / 2;

    const approach = easeInOutCubic(clamp(overviewProgress, 0, 1));

    desiredPos.lerp(warehouseFrontPos, 1 - approach);
    desiredTarget.lerp(warehouseFrontTarget, 1 - approach);
    // Hold the security checkpoint in view until the ASN document is revealed.
    const supplierWeight = 1 - smoothstep(0.85, 1, supplierProgress);
    const supplier = supplierJourney(supplierProgress);
    const cameraDistance = size.width < 768 ? 24 : 17;
    desiredPos.lerp(
      scratch.front.set(supplier.truck.x - 11, 12, supplier.truck.z + cameraDistance),
      supplierWeight,
    );
    desiredTarget.lerp(
      scratch.frontTarget.set(
        (supplier.truck.x + supplier.envelope.x) / 2,
        2.4,
        (supplier.truck.z + supplier.envelope.z) / 2,
      ),
      supplierWeight,
    );
    scratch.frontTarget.set(0, 4.8, 10);

    // Follow the truck after gate clearance instead of lingering on the gate
    // boards. The elevated side/rear offset keeps the truck and interior road
    // visible while moving the checkpoint signage behind the camera.
    if (p >= 0.025 && p <= 0.19) {
      let truckX = 0;
      let truckZ = 21.5;

      if (p < 0.09) {
        const departure = smoothstep(0.034, 0.09, p);
        truckZ = lerp(21.5, -4, departure);
      } else if (p < 0.11) {
        truckZ = lerp(-4, -10, smoothstep(0.09, 0.11, p));
      } else if (p < 0.145) {
        const angle = smoothstep(0.11, 0.145, p) * Math.PI;
        truckX = -4.25 + 4.25 * Math.cos(angle);
        truckZ = -10 - 4.25 * Math.sin(angle);
      } else if (p < 0.1667) {
        truckX = -8.5;
        truckZ = lerp(-10, -17.5, smoothstep(0.145, 0.1667, p));
      } else {
        truckX = -8.5;
        truckZ = -17.5;
      }

      const followWeight = smoothstep(0.025, 0.04, p) * (1 - smoothstep(0.165, 0.19, p));
      // Stay inside the eight-metre-wide central portal while crossing the
      // facade; a wider side offset places the camera behind the wall panel.
      desiredPos.lerp(scratch.front.set(truckX + 5, 7, truckZ + 12), followWeight);
      desiredTarget.lerp(scratch.frontTarget.set(truckX, 2.2, truckZ - 3), followWeight);
    }

    // Once receiving is complete, track the forklift instead of leaving the
    // camera aimed at the stationary dock inspector.
    if (p >= 0.225 && p <= 0.65) {
      let forkliftX = -8.5;
      let forkliftZ = -30.5;

      if (p < 0.255) {
        forkliftZ = lerp(-30.5, -25.45, smoothstep(0.225, 0.255, p));
      } else if (p < 0.275) {
        forkliftZ = -25.45;
      } else if (p < 0.287) {
        forkliftZ = lerp(-25.45, -31, smoothstep(0.275, 0.287, p));
      } else if (p < 0.305) {
        const turn = smoothstep(0.287, 0.305, p);
        forkliftX = lerp(-8.5, -3.5, turn);
        forkliftZ = lerp(-31, -33, turn);
      } else if (p < 0.345) {
        const transit = smoothstep(0.305, 0.345, p);
        forkliftX = lerp(-3.5, 3.8, transit * transit * (3 - 2 * transit));
        forkliftZ = lerp(-33, -68, transit);
      } else if (p < 0.375) {
        forkliftX = lerp(3.8, 4.2, smoothstep(0.345, 0.365, p));
        forkliftZ = -68;
      } else if (p < 0.39) {
        forkliftX = lerp(4.2, 6.35, smoothstep(0.375, 0.385, p));
        forkliftZ = -68;
      } else if (p < 0.42) {
        forkliftX = lerp(6.35, 3.5, smoothstep(0.39, 0.415, p));
        forkliftZ = -68;
      } else if (p < 0.48) {
        forkliftX = 3.5;
        forkliftZ = lerp(-68, -90, smoothstep(0.44, 0.48, p));
      } else if (p < 0.51) {
        const gapApproach = smoothstep(0.48, 0.51, p);
        forkliftX = lerp(3.5, 8, gapApproach);
        forkliftZ = lerp(-90, -104, gapApproach);
      } else if (p < 0.53) {
        forkliftX = 8;
        forkliftZ = lerp(-104, -112, smoothstep(0.51, 0.53, p));
      } else if (p < 0.56) {
        const laneChange = smoothstep(0.53, 0.56, p);
        forkliftX = lerp(8, 0, laneChange);
        forkliftZ = lerp(-112, -121, laneChange);
      } else if (p < 0.6) {
        forkliftX = 0;
        forkliftZ = lerp(-121, -145, smoothstep(0.56, 0.6, p));
      } else {
        const assemblyApproach = smoothstep(0.6, 0.625, p);
        forkliftX = lerp(0, 3.5, assemblyApproach);
        forkliftZ = lerp(-145, -157, assemblyApproach);
      }

      const forkliftWeight = smoothstep(0.225, 0.24, p) * (1 - smoothstep(0.625, 0.65, p));
      const assemblyApproach = smoothstep(0.5, 0.585, p);
      desiredPos.lerp(
        scratch.front.set(
          forkliftX - lerp(9, 14, assemblyApproach),
          lerp(6, 9, assemblyApproach),
          forkliftZ + lerp(9, 14, assemblyApproach),
        ),
        forkliftWeight,
      );
      desiredTarget.lerp(scratch.frontTarget.set(forkliftX, 1.8, forkliftZ), forkliftWeight);
    }

    // Hold a clean dispatch-bay overview through loading and door closure,
    // then travel to the exit overview. Keeping this camera below the roof
    // trusses prevents the roof edge from blocking the upper half of the shot.
    if (p >= 0.91) {
      const exitTransition = smoothstep(0.95, 1, p);
      const dispatchWeight = smoothstep(0.91, 0.925, p);
      desiredPos.lerp(
        scratch.front.set(
          lerp(8, 10, exitTransition),
          lerp(6, 7, exitTransition),
          lerp(-190, -230, exitTransition),
        ),
        dispatchWeight,
      );
      desiredTarget.lerp(
        scratch.frontTarget.set(lerp(-6, 0.8, exitTransition), 2, lerp(-207, -252, exitTransition)),
        dispatchWeight,
      );
    }

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
      scene.fog.near = lerp(65, 45, approach);
      scene.fog.far = lerp(350, 280, approach);
    }
  });

  return null;
}
