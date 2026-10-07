import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { JourneyStage } from "./data/journeyStages";

interface JourneyRoadmap3DProps {
  stages: JourneyStage[];
  activeIndex: number;
  scrollProgress: number; // 0 to 1
  onSelectStage: (index: number) => void;
}

// 3D Spline coordinates threading through the complete warehouse world
const ROADMAP_WAYPOINTS: [number, number, number][] = [
  [0, 0.16, 36], // 0: Approach outside
  [1.2, 0.16, 14], // 1: Gate Entry Checkpoint (Stage 1)
  [-6.5, 0.16, -6], // 2: Turn into receiving
  [-5.8, 0.16, -25], // 3: Receiving Dock Bay (Stage 2)
  [2.2, 0.16, -48], // 4: Turn into high-bay aisle
  [3.5, 0.16, -74], // 5: Store / Putaway Rack (Stage 3)
  [-4.0, 0.16, -98], // 6: Turn into inventory matrix
  [0.0, 0.16, -118], // 7: Inventory Center (Stage 4)
  [5.5, 0.16, -142], // 8: Turn into assembly line
  [1.2, 0.16, -165], // 9: Assembly Station (Stage 5)
  [-6.2, 0.16, -190], // 10: Turn into outbound dock
  [-4.5, 0.16, -212], // 11: Dispatch Outbound Bay (Stage 6)
  [1.8, 0.16, -240], // 12: Turn into exit gate
  [0.0, 0.16, -258], // 13: Gate Exit Checkpoint (Stage 7)
];

// Node milestone fractions along the 3D curve (matching the 7 stages)
export const STAGE_CURVE_FRACTIONS = [
  0.06, // Stage 1: Gate Entry
  0.22, // Stage 2: GRN
  0.38, // Stage 3: Putaway
  0.54, // Stage 4: Inventory
  0.7, // Stage 5: Assembly
  0.86, // Stage 6: Dispatch
  0.98, // Stage 7: Gate Exit
];

export function JourneyRoadmap3D({
  stages,
  activeIndex,
  scrollProgress,
  onSelectStage,
}: JourneyRoadmap3DProps) {
  // Master 3D Catmull-Rom Spline Curve
  const spline = useMemo(() => {
    const vectors = ROADMAP_WAYPOINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    return new THREE.CatmullRomCurve3(vectors, false, "catmullrom", 0.4);
  }, []);

  // Allocate the route buffers and materials once. Reveal the existing buffer
  // with drawRange instead of generating a full spline on every rendered frame.
  const lines = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(spline.getSpacedPoints(260));
    const activeGeometry = geometry.clone();
    activeGeometry.setDrawRange(0, 0);
    return {
      base: new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0x0891b2, transparent: true, opacity: 0.3 }),
      ),
      active: new THREE.Line(
        activeGeometry,
        new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.95 }),
      ),
    };
  }, [spline]);
  useEffect(
    () => () => {
      lines.base.geometry.dispose();
      lines.base.material.dispose();
      lines.active.geometry.dispose();
      lines.active.material.dispose();
    },
    [lines],
  );
  const milestonePoints = useMemo(
    () => STAGE_CURVE_FRACTIONS.map((fraction) => spline.getPointAt(fraction)),
    [spline],
  );
  const headPhotonRef = useRef<THREE.Group>(null);
  const headPoint = useMemo(() => new THREE.Vector3(), []);
  const previousProgress = useRef(-1);

  useFrame(() => {
    const clamped = Math.max(0, Math.min(1, scrollProgress));
    if (previousProgress.current === clamped) return;
    previousProgress.current = clamped;
    lines.active.geometry.setDrawRange(0, Math.floor(clamped * 260) + 1);
    if (headPhotonRef.current) {
      spline.getPointAt(clamped, headPoint);
      headPhotonRef.current.position.set(headPoint.x, headPoint.y + 0.1, headPoint.z);
    }
  });

  return (
    <group>
      <primitive object={lines.base} />
      <primitive object={lines.active} />

      <group ref={headPhotonRef}>
        <mesh>
          <sphereGeometry args={[0.22, 16, 16]} />
          <meshStandardMaterial color="#ffffff" emissive="#22d3ee" emissiveIntensity={3.5} />
        </mesh>
        <pointLight color="#22d3ee" intensity={2.5} distance={6} decay={2} />
      </group>

      {/* ─── 4. THE 7 MILESTONE NODES ALONG THE ROADMAP ─── */}
      {stages.map((stage, idx) => {
        const pt = milestonePoints[idx];
        const isActive = idx === activeIndex;
        const isCompleted = idx < activeIndex;

        return (
          <group key={stage.id} position={[pt.x, pt.y + 0.04, pt.z]}>
            {/* Ground Indicator Ring */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.3, 0.45, 24]} />
              <meshStandardMaterial
                color={isActive ? "#22d3ee" : isCompleted ? "#06b6d4" : "#475569"}
                emissive={isActive ? "#22d3ee" : isCompleted ? "#0891b2" : "#0f172a"}
                emissiveIntensity={isActive ? 2.5 : 0.5}
                transparent
                opacity={isActive ? 1 : 0.6}
              />
            </mesh>

            {/* Glowing Core Dot */}
            <mesh position={[0, 0.08, 0]}>
              <sphereGeometry args={[isActive ? 0.16 : 0.1, 12, 12]} />
              <meshStandardMaterial
                color={isActive ? "#ffffff" : isCompleted ? "#38bdf8" : "#94a3b8"}
                emissive={isActive ? "#22d3ee" : "#0284c7"}
                emissiveIntensity={isActive ? 3 : 0.8}
              />
            </mesh>

            {/* In-Scene 3D Floating Node Tag */}
            <Html position={[0, 0.8, 0]} center distanceFactor={18} zIndexRange={[50, 0]}>
              <button
                type="button"
                onClick={() => onSelectStage(idx)}
                className={`font-mono text-xs uppercase tracking-widest whitespace-nowrap transition-all duration-300 focus:outline-none cursor-pointer ${
                  isActive
                    ? "text-cyan-300 font-black drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] scale-110"
                    : isCompleted
                      ? "text-slate-300 font-bold opacity-75 hover:opacity-100 hover:text-cyan-300"
                      : "text-slate-400 font-medium opacity-40 hover:opacity-90 hover:text-white"
                }`}
              >
                ● {stage.number} {stage.title}
              </button>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
