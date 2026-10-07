import { useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";

export function SecurityRoom({
  clearance = 0,
  side = "right",
}: {
  clearance?: number;
  side?: "left" | "right";
}) {
  const direction = side === "left" ? -1 : 1;

  // Triangular gable profile matching warehouse roof geometry
  const gableShape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-1.4, 0);
    s.lineTo(0, 0.9);
    s.lineTo(1.4, 0);
    s.lineTo(1.4, -0.04);
    s.lineTo(-1.3, -0.04);
    s.closePath();
    return s;
  }, []);

  const slopeAngle = Math.atan2(0.9, 1.5);
  const slopeLength = Math.sqrt(1.5 * 1.5 + 0.9 * 0.9);

  return (
    <group>
      <group position={[direction * 4.35, 0, 0]}>
        {/* Foundation Platform */}
        <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.2, 0.2, 3.2]} />
          <meshStandardMaterial color="#64748b" roughness={0.6} />
        </mesh>

        {/* Main Solid Guard House Room Body */}
        <mesh position={[0, 1.35, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.8, 2.3, 2.8]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.65} />
        </mesh>

        {/* Base Concrete Wainscot / Band */}
        <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.86, 0.6, 2.86]} />
          <meshStandardMaterial color="#475569" roughness={0.5} />
        </mesh>

        {/* Large Security Glass Observation Window (Facing Road / Driveway) */}
        <mesh position={[0, 1.5, 1.41]}>
          <boxGeometry args={[2.0, 1.2, 0.08]} />
          <meshStandardMaterial color="#38bdf8" roughness={0.1} metalness={0.8} transparent opacity={0.6} />
        </mesh>
        {/* Window Frame / Sill */}
        <mesh position={[0, 1.5, 1.44]}>
          <boxGeometry args={[2.1, 0.06, 0.1]} />
          <meshStandardMaterial color="#1e293b" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.9, 1.41]}>
          <boxGeometry args={[2.1, 0.08, 0.08]} />
          <meshStandardMaterial color="#1e293b" roughness={0.4} />
        </mesh>

        {/* Side Windows */}
        <mesh position={[1.41, 1.5, 0]} rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[1.4, 1.2, 0.08]} />
          <meshStandardMaterial color="#38bdf8" roughness={0.1} metalness={0.8} transparent opacity={0.6} />
        </mesh>

        {/* Security Door on Side / Rear */}
        <mesh position={[-1.41, 1.3, -0.6]} rotation={[0, Math.PI / 2, 0]} castShadow>
          <boxGeometry args={[0.9, 2.0, 0.08]} />
          <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh position={[-1.44, 1.3, -0.8]}>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshStandardMaterial color="#e2e8f0" metalness={0.9} roughness={0.2} />
        </mesh>

        {/* ─── TRIANGULAR SLOPED ROOF ─── */}
        <group position={[0, 2.5, 0]}>
          <mesh position={[0, 0, 1.46]} castShadow receiveShadow>
            <extrudeGeometry args={[gableShape, { depth: 0.12, bevelEnabled: false }]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.7} metalness={0.15} />
          </mesh>
          <mesh position={[0, 0, -1.46]} castShadow receiveShadow>
            <extrudeGeometry args={[gableShape, { depth: 0.12, bevelEnabled: false }]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.7} metalness={0.15} />
          </mesh>

          <mesh position={[-0.75, 0.45, 1.52]} rotation={[0, 0, slopeAngle]} castShadow>
            <boxGeometry args={[slopeLength + 0.2, 0.14, 0.08]} />
            <meshStandardMaterial color="#187d86" roughness={0.45} metalness={0.3} />
          </mesh>
          <mesh position={[0.75, 0.45, 1.52]} rotation={[0, 0, -slopeAngle]} castShadow>
            <boxGeometry args={[slopeLength + 0.2, 0.14, 0.08]} />
            <meshStandardMaterial color="#187d86" roughness={0.45} metalness={0.3} />
          </mesh>

          <mesh position={[-0.75, 0.45, 1.57]} rotation={[0, 0, slopeAngle]}>
            <boxGeometry args={[slopeLength + 0.15, 0.03, 0.03]} />
            <meshStandardMaterial color="#ffffff" emissive="#22d3ee" emissiveIntensity={2.0} />
          </mesh>
          <mesh position={[0.75, 0.45, 1.57]} rotation={[0, 0, -slopeAngle]}>
            <boxGeometry args={[slopeLength + 0.15, 0.03, 0.03]} />
            <meshStandardMaterial color="#ffffff" emissive="#22d3ee" emissiveIntensity={2.0} />
          </mesh>

          <mesh position={[-0.75, 0.45, 0]} rotation={[0, 0, slopeAngle]} castShadow receiveShadow>
            <boxGeometry args={[slopeLength + 0.2, 0.08, 3.1]} />
            <meshStandardMaterial color="#374151" roughness={0.65} metalness={0.35} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0.75, 0.45, 0]} rotation={[0, 0, -slopeAngle]} castShadow receiveShadow>
            <boxGeometry args={[slopeLength + 0.2, 0.08, 3.1]} />
            <meshStandardMaterial color="#374151" roughness={0.65} metalness={0.35} side={THREE.DoubleSide} />
          </mesh>

          <mesh position={[0, 0.94, 0]} castShadow>
            <boxGeometry args={[0.3, 0.12, 3.14]} />
            <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.6} />
          </mesh>
          <mesh position={[0, 1.05, 1.4]}>
            <cylinderGeometry args={[0.04, 0.04, 0.12, 12]} />
            <meshStandardMaterial color="#ffffff" emissive="#ef4444" emissiveIntensity={2.5} />
          </mesh>
        </group>
      </group>

      {/* ─── "GATE ENTRY" OVERHEAD SIGN ─── */}
      <group position={[direction * 4.35, 3.8, 1.2]}>
        <Html center distanceFactor={16}>
          <div className="pointer-events-none whitespace-nowrap rounded-lg bg-blue-700 px-5 py-2 border-2 border-blue-400 shadow-[0_4px_25px_rgba(30,58,138,0.7)] flex items-center gap-2">
            <span className="text-white text-xs font-black tracking-[0.2em] uppercase">GATE ENTRY</span>
          </div>
        </Html>
      </group>

      {/* ─── STANDING SECURITY GUARD WITH CLIPBOARD & HIGH-VIS "SECURITY" VEST ─── */}
      <group position={[direction * 1.6, 0, -0.9]} rotation={[0, direction * 0.8, 0]}>
        {/* Shoes */}
        <mesh position={[-0.12, 0.08, 0]} castShadow>
          <boxGeometry args={[0.18, 0.16, 0.28]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
        <mesh position={[0.12, 0.08, 0]} castShadow>
          <boxGeometry args={[0.18, 0.16, 0.28]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
        {/* Legs / Trousers */}
        <mesh position={[-0.12, 0.48, 0]} castShadow>
          <boxGeometry args={[0.2, 0.64, 0.22]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} />
        </mesh>
        <mesh position={[0.12, 0.48, 0]} castShadow>
          <boxGeometry args={[0.2, 0.64, 0.22]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} />
        </mesh>
        {/* Torso & High-Vis Vest */}
        <mesh position={[0, 1.12, 0]} castShadow>
          <boxGeometry args={[0.48, 0.72, 0.28]} />
          <meshStandardMaterial color="#1e3a8a" roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.12, 0.01]}>
          <boxGeometry args={[0.5, 0.7, 0.3]} />
          <meshStandardMaterial color="#eab308" roughness={0.5} />
        </mesh>
        <mesh position={[0, 1.12, 0.14]}>
          <boxGeometry args={[0.2, 0.5, 0.04]} />
          <meshStandardMaterial color="#f97316" roughness={0.4} />
        </mesh>
        {/* Clipboard */}
        <mesh position={[0.28, 1.05, 0.1]} rotation={[0, -0.4, 0]}>
          <boxGeometry args={[0.18, 0.24, 0.03]} />
          <meshStandardMaterial color="#475569" roughness={0.4} />
        </mesh>
        {/* Head & Security Cap */}
        <mesh position={[0, 1.62, 0]} castShadow>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshStandardMaterial color="#fbcfe8" roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.76, 0.02]} rotation={[0.2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.18, 0.17, 0.1, 16]} />
          <meshStandardMaterial color="#0f172a" roughness={0.5} />
        </mesh>
        <mesh position={[0, 1.72, 0.14]} rotation={[0.4, 0, 0]}>
          <boxGeometry args={[0.2, 0.03, 0.12]} />
          <meshStandardMaterial color="#0f172a" roughness={0.5} />
        </mesh>
      </group>

      {/* ─── SECURITY PERSONNEL HUD BADGE ─── */}
      <group position={[direction * 3.4, 2.2, 0]}>
        <Html center distanceFactor={16}>
          <div className="pointer-events-none whitespace-nowrap rounded-lg bg-cyan-950/80 px-2.5 py-1 border border-cyan-500/50 backdrop-blur-md shadow-[0_0_12px_rgba(6,182,212,0.4)]">
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-[9px] font-bold text-cyan-200 tracking-wider">
                GATE SECURITY POST
              </span>
            </div>
            {clearance > 0 && (
              <div className="mt-0.5 text-[8px] font-mono text-emerald-300 font-bold">
                VEHICLE CLEARED
              </div>
            )}
          </div>
        </Html>
      </group>
    </group>
  );
}
