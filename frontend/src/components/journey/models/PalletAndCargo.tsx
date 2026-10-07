interface PalletAndCargoProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  hasCargo?: boolean;
  isWrapped?: boolean; // stretch wrap film for dispatch
  boxCount?: number;
}

export function PalletAndCargo({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  hasCargo = true,
  isWrapped = false,
  boxCount = 8,
}: PalletAndCargoProps) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* ─── WOODEN PALLET ─── */}
      <group position={[0, 0.08, 0]}>
        {/* 3 Longitudinal Stringer Runners */}
        {[-0.5, 0, 0.5].map((sx, i) => (
          <mesh key={`stringer-${i}`} position={[sx, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.09, 0.12, 1.2]} />
            <meshStandardMaterial color="#854d0e" roughness={0.9} />
          </mesh>
        ))}

        {/* 5 Top Deck Slats */}
        {[-0.5, -0.25, 0, 0.25, 0.5].map((sz, i) => (
          <mesh key={`slat-${i}`} position={[0, 0.075, sz]} castShadow receiveShadow>
            <boxGeometry args={[1.2, 0.03, 0.16]} />
            <meshStandardMaterial color="#a16207" roughness={0.85} />
          </mesh>
        ))}
      </group>

      {/* ─── CARGO CARTONS ─── */}
      {hasCargo && (
        <group position={[0, 0.2, 0]}>
          {/* Layer 1: 4 Boxes */}
          {[
            [-0.28, 0.3, -0.28],
            [0.28, 0.3, -0.28],
            [-0.28, 0.3, 0.28],
            [0.28, 0.3, 0.28],
          ].map(([bx, by, bz], i) => (
            <group key={`b1-${i}`} position={[bx, by, bz]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.54, 0.58, 0.54]} />
                <meshStandardMaterial color="#b45309" roughness={0.8} />
              </mesh>
              {/* White Barcode Shipping Label */}
              <mesh position={[0, 0.05, 0.272]}>
                <planeGeometry args={[0.22, 0.14]} />
                <meshStandardMaterial color="#f8fafc" roughness={0.3} />
              </mesh>
            </group>
          ))}

          {/* Layer 2: 4 Boxes */}
          {boxCount > 4 &&
            [
              [-0.28, 0.88, -0.28],
              [0.28, 0.88, -0.28],
              [-0.28, 0.88, 0.28],
              [0.28, 0.88, 0.28],
            ].map(([bx, by, bz], i) => (
              <group key={`b2-${i}`} position={[bx, by, bz]}>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[0.54, 0.58, 0.54]} />
                  <meshStandardMaterial color="#d97706" roughness={0.8} />
                </mesh>
                <mesh position={[0, 0.05, 0.272]}>
                  <planeGeometry args={[0.22, 0.14]} />
                  <meshStandardMaterial color="#f8fafc" roughness={0.3} />
                </mesh>
              </group>
            ))}

          {/* Optional Stretch-Wrap Film Layer (Dispatch Scene) */}
          {isWrapped && (
            <mesh position={[0, 0.6, 0]}>
              <boxGeometry args={[1.15, 1.25, 1.15]} />
              <meshStandardMaterial
                color="#e0f2fe"
                roughness={0.1}
                metalness={0.3}
                transparent
                opacity={0.38}
              />
            </mesh>
          )}
        </group>
      )}
    </group>
  );
}
