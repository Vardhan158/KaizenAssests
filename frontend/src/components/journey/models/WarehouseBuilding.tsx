import { WarehouseCompound } from "./WarehouseCompound";
import { WarehouseRoof } from "./WarehouseRoof";

export function WarehouseBuilding() {
  return (
    <group>
      <WarehouseCompound />
      <WarehouseRoof />
      {/* ─── GROUND / FLOORS ─── */}
      {/* Concrete yard and a dedicated inbound asphalt road through the security gate. */}
      <mesh position={[0, -0.02, 25]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[70, 50]} />
        <meshStandardMaterial color="#788582" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.002, 25]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[5.8, 50]} />
        <meshStandardMaterial color="#30383f" roughness={0.96} metalness={0} />
      </mesh>
      {/* The road opens into the truck turning apron inside the entrance. */}
      <mesh position={[-4, 0.002, -10]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[28, 20]} />
        <meshStandardMaterial color="#414c55" roughness={0.9} />
      </mesh>
      {[-2.65, 2.65].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.012, 25]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.12, 50]} />
            <meshStandardMaterial color="#f1eee0" roughness={0.9} />
          </mesh>
          {/* Leave the checkpoint shoulder open for the guard and security room. */}
          {[5, 23, 29, 35, 41, 47].map((z, i) => (
            <mesh key={z} position={[Math.sign(x) * 3.03, 0.09, z]} receiveShadow castShadow>
              <boxGeometry args={[0.26, 0.18, z === 5 ? 10 : 5.9]} />
              <meshStandardMaterial color={i % 2 ? "#d9d5c9" : "#55616b"} roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Painted direction arrows follow the truck toward the warehouse. */}
      {[8, 27, 40].map((z) => (
        <group key={z} position={[0, 0.014, z]}>
          <mesh position={[0, 0, 0.4]}>
            <boxGeometry args={[0.17, 0.008, 1.35]} />
            <meshStandardMaterial color="#f4f0dc" roughness={0.9} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * 0.24, 0, -0.18]}
              rotation={[0, (side * Math.PI) / 4, 0]}
            >
              <boxGeometry args={[0.16, 0.008, 0.72]} />
              <meshStandardMaterial color="#f4f0dc" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 0.018, 16.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.2, 0.35]} />
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </mesh>

      {/* Interior Concrete Polished Floor (Z from 0 to -300) */}
      <mesh position={[0, 0, -145]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 290]} />
        <meshStandardMaterial color="#94a3ab" roughness={0.7} metalness={0.1} />
      </mesh>

      {/* Floor Floor Guidance Lines / Safety Striping */}
      {[-8, 0, 8].map((lx, i) => (
        <mesh key={i} position={[lx, 0.01, -145]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.15, 280]} />
          <meshStandardMaterial
            color="#06b6d4"
            emissive="#0891b2"
            emissiveIntensity={0.4}
            transparent
            opacity={0.35}
          />
        </mesh>
      ))}

      {/* ─── WAREHOUSE FRONT FACADE (Z = 0) ─── */}
      <group position={[0, 5, 0]}>
        {/* Left Wall Panel */}
        <mesh position={[-16, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[16, 10, 1.2]} />
          <meshStandardMaterial color="#d4dedb" roughness={0.7} metalness={0.15} />
        </mesh>
        {/* Right Wall Panel */}
        <mesh position={[16, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[16, 10, 1.2]} />
          <meshStandardMaterial color="#d4dedb" roughness={0.7} metalness={0.15} />
        </mesh>
        {/* Teal plinth and vertical metal cladding ribs give the facade depth. */}
        {[-16, 16].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh position={[0, -4.15, 0.64]} castShadow>
              <boxGeometry args={[16, 1.7, 0.12]} />
              <meshStandardMaterial color="#247984" roughness={0.55} />
            </mesh>
            {Array.from({ length: 15 }, (_, i) => (
              <mesh key={i} position={[i - 7, 0.7, 0.64]} castShadow>
                <boxGeometry args={[0.06, 8.3, 0.09]} />
                <meshStandardMaterial color="#b8c9c8" metalness={0.35} roughness={0.5} />
              </mesh>
            ))}
          </group>
        ))}
        {/* Lintel Beam above Portal */}
        <mesh position={[0, 3.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[16, 3, 1.4]} />
          <meshStandardMaterial color="#187d86" roughness={0.45} metalness={0.3} />
        </mesh>
        {/* Illuminated Nexus Portal Header Sign */}
        <mesh position={[0, 3.6, 0.75]}>
          <boxGeometry args={[8, 0.9, 0.1]} />
          <meshStandardMaterial color="#ffffff" emissive="#22d3ee" emissiveIntensity={2.5} />
        </mesh>
      </group>

      {/* ─── STRUCTURAL INTERIOR ROOF TRUSSES & HIGH-BAY LIGHTS ─── */}
      {[-30, -65, -100, -135, -170, -205, -240].map((trussZ, i) => (
        <group key={i} position={[0, 9.5, trussZ]}>
          {/* Cross Steel Beam */}
          <mesh castShadow>
            <boxGeometry args={[48, 0.6, 0.6]} />
            <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Vertical Support Columns Left & Right */}
          <mesh position={[-23, -4.5, 0]} castShadow>
            <boxGeometry args={[0.8, 9, 0.8]} />
            <meshStandardMaterial color="#427985" metalness={0.45} roughness={0.45} />
          </mesh>
          <mesh position={[23, -4.5, 0]} castShadow>
            <boxGeometry args={[0.8, 9, 0.8]} />
            <meshStandardMaterial color="#427985" metalness={0.45} roughness={0.45} />
          </mesh>

          {/* Industrial High-Bay LED Lights */}
          {[-12, 0, 12].map((lx, j) => (
            <group key={j} position={[lx, -0.4, 0]}>
              <mesh>
                <cylinderGeometry args={[0.6, 0.8, 0.3, 16]} />
                <meshStandardMaterial color="#475569" metalness={0.7} />
              </mesh>
              <mesh position={[0, -0.16, 0]}>
                <cylinderGeometry args={[0.55, 0.55, 0.05, 16]} />
                <meshStandardMaterial color="#ffffff" emissive="#e0f2fe" emissiveIntensity={3} />
              </mesh>
              <pointLight color="#bae6fd" intensity={3} distance={24} decay={2} />
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}
