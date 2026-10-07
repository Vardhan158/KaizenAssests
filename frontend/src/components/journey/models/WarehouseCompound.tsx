type Vector = [number, number, number];

function WallRun({
  position,
  length,
  rotation = 0,
}: {
  position: Vector;
  length: number;
  rotation?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[length, 2.1, 0.3]} />
        <meshStandardMaterial color="#becbc7" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.22, 0]} receiveShadow>
        <boxGeometry args={[length, 0.44, 0.36]} />
        <meshStandardMaterial color="#537a7a" roughness={0.8} />
      </mesh>
      <mesh position={[0, 2.14, 0]} castShadow>
        <boxGeometry args={[length, 0.12, 0.46]} />
        <meshStandardMaterial color="#e1e6df" roughness={0.65} />
      </mesh>
    </group>
  );
}

function Pillar({ position, gate = false }: { position: Vector; gate?: boolean }) {
  const height = gate ? 3 : 2.45;
  return (
    <group position={position}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.55, height, 0.55]} />
        <meshStandardMaterial color={gate ? "#247984" : "#98b0aa"} roughness={0.7} />
      </mesh>
      <mesh position={[0, height + 0.06, 0]} castShadow>
        <boxGeometry args={[0.7, 0.12, 0.7]} />
        <meshStandardMaterial color="#e1e6df" roughness={0.6} />
      </mesh>
      {gate && (
        <mesh position={[0, height + 0.19, 0]}>
          <boxGeometry args={[0.36, 0.18, 0.36]} />
          <meshStandardMaterial color="#fff0cc" emissive="#ffe4ac" emissiveIntensity={0.8} />
        </mesh>
      )}
    </group>
  );
}

export function WarehouseCompound() {
  // Match the existing checkpoints: entry Z=15, departure Z=-252.
  // Gate gaps include the security rooms and keep the vehicle lane unobstructed.
  return (
    <group>
      <mesh position={[0, -0.035, -118.5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[70, 267]} />
        <meshStandardMaterial color="#788582" roughness={0.95} />
      </mesh>
      {[-32, 32].map((x) => (
        <group key={x}>
          <WallRun position={[x, 0, -118.5]} length={267} rotation={Math.PI / 2} />
          {Array.from({ length: 24 }, (_, i) => (
            <Pillar key={i} position={[x, 0, 15 - i * (267 / 23)]} />
          ))}
        </group>
      ))}
      {/* Front wall returns stop outside the left security cabin and the entry road. */}
      <WallRun position={[-19.25, 0, 15]} length={25.5} />
      <WallRun position={[17.75, 0, 15]} length={28.5} />
      <Pillar position={[-6.5, 0, 15]} gate />
      <Pillar position={[3.5, 0, 15]} gate />
      {[-25.5, -19, -12.5, 10.5, 17.5, 24.5].map((x) => (
        <Pillar key={x} position={[x, 0, 15]} />
      ))}
      {/* Rear wall returns leave room for the exit barrier and its right-side cabin. */}
      <WallRun position={[-17.75, 0, -252]} length={28.5} />
      <WallRun position={[19.25, 0, -252]} length={25.5} />
      <Pillar position={[-3.5, 0, -252]} gate />
      <Pillar position={[6.5, 0, -252]} gate />
      {[-24.5, -17.5, -10.5, 12.5, 19, 25.5].map((x) => (
        <Pillar key={x} position={[x, 0, -252]} />
      ))}
    </group>
  );
}
