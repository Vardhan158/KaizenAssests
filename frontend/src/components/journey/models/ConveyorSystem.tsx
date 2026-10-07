interface ConveyorSystemProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  length?: number;
  width?: number;
  height?: number;
}

export function ConveyorSystem({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  length = 12,
  width = 1.4,
  height = 1.1,
}: ConveyorSystemProps) {
  const rollerCount = Math.floor(length / 0.4);

  return (
    <group position={position} rotation={rotation}>
      {/* ─── STEEL SUPPORT LEGS ─── */}
      {Array.from({ length: Math.floor(length / 3) + 1 }).map((_, i) => {
        const legZ = (i / Math.floor(length / 3) - 0.5) * (length - 0.6);
        return (
          <group key={`leg-${i}`} position={[0, height / 2, legZ]}>
            {/* Left Leg */}
            <mesh position={[-width / 2, 0, 0]} castShadow>
              <boxGeometry args={[0.08, height, 0.08]} />
              <meshStandardMaterial color="#1e293b" metalness={0.7} />
            </mesh>
            {/* Right Leg */}
            <mesh position={[width / 2, 0, 0]} castShadow>
              <boxGeometry args={[0.08, height, 0.08]} />
              <meshStandardMaterial color="#1e293b" metalness={0.7} />
            </mesh>
            {/* Crossbeam */}
            <mesh position={[0, -0.2, 0]} castShadow>
              <boxGeometry args={[width, 0.06, 0.06]} />
              <meshStandardMaterial color="#334155" metalness={0.7} />
            </mesh>
          </group>
        );
      })}

      {/* ─── SIDE GUIDE RAILS (Safety Yellow/Cyan) ─── */}
      <mesh position={[-width / 2 - 0.04, height, 0]} castShadow>
        <boxGeometry args={[0.06, 0.18, length]} />
        <meshStandardMaterial color="#0284c7" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[width / 2 + 0.04, height, 0]} castShadow>
        <boxGeometry args={[0.06, 0.18, length]} />
        <meshStandardMaterial color="#0284c7" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* ─── ROLLER BED OR BELT ─── */}
      <mesh position={[0, height - 0.02, 0]} receiveShadow>
        <boxGeometry args={[width - 0.04, 0.06, length - 0.1]} />
        <meshStandardMaterial color="#0f172a" roughness={0.7} metalness={0.3} />
      </mesh>

      {/* Cylindrical Rollers */}
      {Array.from({ length: rollerCount }).map((_, r) => {
        const rollerZ = (r / rollerCount - 0.5) * (length - 0.6);
        return (
          <mesh
            key={`roller-${r}`}
            position={[0, height + 0.02, rollerZ]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry args={[0.04, 0.04, width - 0.1, 12]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.2} />
          </mesh>
        );
      })}
    </group>
  );
}
