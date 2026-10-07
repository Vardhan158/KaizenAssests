interface StorageRackProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  bays?: number; // number of horizontal rack bays
  tiers?: number; // number of shelf levels
  width?: number;
  height?: number;
  depth?: number;
}

export function StorageRack({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  bays = 3,
  tiers = 4,
  width = 3.2,
  height = 7.2,
  depth = 1.3,
}: StorageRackProps) {
  const bayWidth = width;
  const tierHeight = height / tiers;

  return (
    <group position={position} rotation={rotation}>
      {/* ─── UPRIGHT FRAMES (Industrial Blue Steel) ─── */}
      {Array.from({ length: bays + 1 }).map((_, i) => {
        const frameX = i * bayWidth - (bays * bayWidth) / 2;
        return (
          <group key={`upright-${i}`} position={[frameX, height / 2, 0]}>
            {/* Front Post */}
            <mesh position={[0, 0, depth / 2]} castShadow receiveShadow>
              <boxGeometry args={[0.1, height, 0.1]} />
              <meshStandardMaterial color="#0284c7" metalness={0.7} roughness={0.3} />
            </mesh>
            {/* Rear Post */}
            <mesh position={[0, 0, -depth / 2]} castShadow receiveShadow>
              <boxGeometry args={[0.1, height, 0.1]} />
              <meshStandardMaterial color="#0284c7" metalness={0.7} roughness={0.3} />
            </mesh>
            {/* Diagonal Bracing Struts */}
            {Array.from({ length: tiers }).map((__, j) => (
              <mesh
                key={`brace-${j}`}
                position={[0, (j - tiers / 2 + 0.5) * tierHeight, 0]}
                rotation={[0.45 * (j % 2 === 0 ? 1 : -1), 0, 0]}
              >
                <boxGeometry args={[0.04, tierHeight * 1.1, 0.04]} />
                <meshStandardMaterial color="#38bdf8" metalness={0.6} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* ─── HORIZONTAL LOAD BEAMS (Safety Orange) ─── */}
      {Array.from({ length: bays }).map((_, b) => {
        const bayCenterX = b * bayWidth - (bays * bayWidth) / 2 + bayWidth / 2;
        return (
          <group key={`bay-${b}`}>
            {Array.from({ length: tiers }).map((__, t) => {
              const beamY = (t + 1) * tierHeight - 0.2;
              return (
                <group key={`tier-${t}`} position={[bayCenterX, beamY, 0]}>
                  {/* Front Load Beam */}
                  <mesh position={[0, 0, depth / 2]} castShadow receiveShadow>
                    <boxGeometry args={[bayWidth - 0.1, 0.14, 0.08]} />
                    <meshStandardMaterial color="#ea580c" metalness={0.6} roughness={0.3} />
                  </mesh>
                  {/* Rear Load Beam */}
                  <mesh position={[0, 0, -depth / 2]} castShadow receiveShadow>
                    <boxGeometry args={[bayWidth - 0.1, 0.14, 0.08]} />
                    <meshStandardMaterial color="#ea580c" metalness={0.6} roughness={0.3} />
                  </mesh>
                  {/* Wire Decking Shelf Surface */}
                  <mesh position={[0, 0.06, 0]}>
                    <boxGeometry args={[bayWidth - 0.15, 0.02, depth - 0.1]} />
                    <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.4} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}
