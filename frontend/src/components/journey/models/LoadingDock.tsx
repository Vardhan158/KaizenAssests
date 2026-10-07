import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

interface LoadingDockProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  doorOpenProgress?: number; // 0 to 1
  doorNumber?: string;
  pickupLane?: boolean;
}

export function LoadingDock({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  doorOpenProgress = 0,
  doorNumber = "BAY 02",
  pickupLane = false,
}: LoadingDockProps) {
  const shutterRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (shutterRef.current) {
      // Shutter rolls up vertically (0 = Y: 1.8, 1 = Y: 4.2)
      shutterRef.current.position.y = 1.8 + doorOpenProgress * 2.4;
      shutterRef.current.scale.y = Math.max(0.1, 1 - doorOpenProgress * 0.85);
    }
  });

  return (
    <group position={position} rotation={rotation}>
      {/* Recessed ground-level pickup lane keeps the forklift out of solid concrete. */}
      {pickupLane ? (
        <>
          {[-2.55, 2.55].map((x) => (
            <mesh key={x} position={[x, 0.6, 0]} castShadow receiveShadow>
              <boxGeometry args={[2.9, 1.2, 5]} />
              <meshStandardMaterial color="#334155" roughness={0.7} />
            </mesh>
          ))}
          <mesh position={[0, 0.6, 1.675]} castShadow receiveShadow>
            <boxGeometry args={[2.2, 1.2, 1.65]} />
            <meshStandardMaterial color="#334155" roughness={0.7} />
          </mesh>
          {[-1.1, 1.1].map((x) => (
            <mesh key={x} position={[x, 1.21, -0.825]}>
              <boxGeometry args={[0.08, 0.025, 3.35]} />
              <meshStandardMaterial color="#eab308" />
            </mesh>
          ))}
        </>
      ) : (
        <mesh position={[0, 0.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[8, 1.2, 5]} />
          <meshStandardMaterial color="#334155" metalness={0.3} roughness={0.7} />
        </mesh>
      )}

      {/* Yellow Safety Stripe on Edge */}
      <mesh position={[0, 1.21, 2.45]}>
        <boxGeometry args={[8.0, 0.04, 0.2]} />
        <meshStandardMaterial color="#eab308" roughness={0.4} />
      </mesh>

      {/* Rubber Bumper Pads Left & Right */}
      {[-3.2, 3.2].map((bx, i) => (
        <mesh key={i} position={[bx, 0.8, 2.55]} castShadow>
          <boxGeometry args={[0.4, 0.8, 0.2]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>
      ))}

      {/* Hydraulic Dock Leveler Plate */}
      <mesh position={[0, 1.22, pickupLane ? 1.7 : 1.2]} rotation={[0.02, 0, 0]}>
        <boxGeometry args={[2.4, 0.06, pickupLane ? 1.5 : 2.2]} />
        <meshStandardMaterial color="#0284c7" metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Industrial Rollup Shutter Door */}
      <group position={[0, 0, -2.4]}>
        {/* Open frame: uprights and lintel rather than a solid block across the lane. */}
        {[-2.1, 2.1].map((x) => (
          <mesh key={x} position={[x, 2.2, 0]} castShadow>
            <boxGeometry args={[0.2, 4.4, 0.3]} />
            <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[0, 4.3, 0]} castShadow>
          <boxGeometry args={[4.4, 0.2, 0.3]} />
          <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.3} />
        </mesh>

        {/* Moving Shutter Slats */}
        <mesh position={[0, 1.8, 0.02]} ref={shutterRef}>
          <boxGeometry args={[3.8, 3.4, 0.05]} />
          <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.4} />
        </mesh>

        {/* Illuminated Bay Number Plate */}
        <mesh position={[0, 4.2, 0.2]}>
          <boxGeometry args={[1.8, 0.5, 0.05]} />
          <meshStandardMaterial color="#ffffff" emissive="#38bdf8" emissiveIntensity={2} />
        </mesh>
      </group>
    </group>
  );
}
