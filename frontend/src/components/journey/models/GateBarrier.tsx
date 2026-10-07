import { SecurityRoom } from "./SecurityRoom";

interface GateBarrierProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  barrierOpenProgress?: number; // 0 (closed) to 1 (fully open)
  securitySide?: "left" | "right";
}

export function GateBarrier({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  barrierOpenProgress = 0,
  securitySide = "right",
}: GateBarrierProps) {
  const opening = Math.max(0, Math.min(1, barrierOpenProgress));

  return (
    <group position={position} rotation={rotation}>
      <group>
        <SecurityRoom clearance={opening} side={securitySide} />
      </group>

      {/* ─── BLACK & YELLOW STRIPED SPEED BUMP ─── */}
      <group position={[0, 0.05, 0]}>
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[5.2, 0.1, 0.7]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} />
        </mesh>
        {[-2.0, -1.0, 0.0, 1.0, 2.0].map((bx, i) => (
          <mesh key={i} position={[bx, 0.06, 0]}>
            <boxGeometry args={[0.45, 0.04, 0.72]} />
            <meshStandardMaterial color="#eab308" roughness={0.4} />
          </mesh>
        ))}
      </group>

      {/* Barrier Stanchion Post (Vibrant Industrial Yellow matching reference photo) */}
      <group position={[2.4, 0.75, 0]}>
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.5, 1.5, 0.6]} />
          <meshStandardMaterial color="#f59e0b" metalness={0.7} roughness={0.3} />
        </mesh>

        {/* Warning Indicator Light */}
        <mesh position={[0, 0.82, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.15, 12]} />
          <meshStandardMaterial
            color={opening > 0.95 ? "#22c35e" : "#ef4444"}
            emissive={opening > 0.95 ? "#22c55e" : "#ef4444"}
            emissiveIntensity={2}
          />
        </mesh>

        {/* ─── ROTATING BOOM BARRIER ARM ─── */}
        <group position={[-0.26, 0.5, 0]} rotation={[0, 0, -opening * 1.5]}>
          {/* Main Arm (Red/White Safety Striped) */}
          <mesh position={[-2.4, 0, 0]} castShadow>
            <boxGeometry args={[4.8, 0.12, 0.08]} />
            <meshStandardMaterial color="#f8fafc" metalness={0.3} roughness={0.5} />
          </mesh>
          {/* Red Stripes on Arm */}
          {[-1.0, -2.0, -3.0, -4.0].map((stripeX, i) => (
            <mesh key={i} position={[stripeX, 0, 0]}>
              <boxGeometry args={[0.4, 0.125, 0.085]} />
              <meshStandardMaterial color="#dc2626" />
            </mesh>
          ))}
          {/* Glowing Tip LED */}
          <mesh position={[-4.8, 0, 0]}>
            <sphereGeometry args={[0.08, 12, 12]} />
            <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={3} />
          </mesh>
        </group>
      </group>

      {/* Left Curb / Stanchion Receiver */}
      <mesh position={[-2.4, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.4, 0.8, 0.4]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}
