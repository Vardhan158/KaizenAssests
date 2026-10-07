import { RoundedBox } from "@react-three/drei";

interface LogisticsTruckProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  doorsOpenProgress?: number;
  wheelRotation?: number;
  isReversing?: boolean;
}

type Vector = [number, number, number];

function Panel({
  position,
  size,
  color = "#dce3e8",
  metalness = 0.5,
  radius = 0,
  rotation = [0, 0, 0],
}: {
  position: Vector;
  size: Vector;
  color?: string;
  metalness?: number;
  radius?: number;
  rotation?: Vector;
}) {
  const material = <meshStandardMaterial color={color} metalness={metalness} roughness={0.32} />;
  return radius ? (
    <RoundedBox
      args={size}
      radius={radius}
      smoothness={3}
      position={position}
      rotation={rotation}
      castShadow
      receiveShadow
    >
      {material}
    </RoundedBox>
  ) : (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      {material}
    </mesh>
  );
}

function Lamp({
  position,
  size,
  color,
  intensity = 0.7,
}: {
  position: Vector;
  size: Vector;
  color: string;
  intensity?: number;
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={intensity}
        roughness={0.2}
      />
    </mesh>
  );
}

function Wheel({ position, spin, side }: { position: Vector; spin: number; side: number }) {
  return (
    <group position={position} rotation={[spin, 0, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.49, 0.49, 0.34, 32]} />
        <meshStandardMaterial color="#171b20" roughness={0.94} />
      </mesh>
      {[-0.11, 0, 0.11].map((x) => (
        <mesh key={x} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.475, 0.018, 6, 32]} />
          <meshStandardMaterial color="#090c10" roughness={1} />
        </mesh>
      ))}
      <mesh position={[side * 0.18, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.31, 0.31, 0.035, 32]} />
        <meshStandardMaterial color="#9ca9b5" metalness={0.85} roughness={0.26} />
      </mesh>
      <mesh position={[side * 0.205, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.13, 0.15, 0.09, 24]} />
        <meshStandardMaterial color="#55616d" metalness={0.8} roughness={0.3} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i * Math.PI) / 4;
        return (
          <mesh
            key={i}
            position={[side * 0.205, Math.sin(angle) * 0.225, Math.cos(angle) * 0.225]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.038, 0.038, 0.015, 8]} />
            <meshStandardMaterial color="#28323b" metalness={0.65} roughness={0.4} />
          </mesh>
        );
      })}
    </group>
  );
}

export function LogisticsTruck({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  doorsOpenProgress = 0,
  wheelRotation = 0,
  isReversing = false,
}: LogisticsTruckProps) {
  const doorAngle = Math.max(0, Math.min(1, doorsOpenProgress)) * 2.2;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Ladder chassis and visible running gear. Front points along +Z. */}
      {[-0.72, 0.72].map((x) => (
        <Panel key={x} position={[x, 0.58, 0]} size={[0.16, 0.24, 9.5]} color="#242c33" />
      ))}
      {[3.65, -2.6, -3.85].map((z) => (
        <group key={z}>
          <Panel position={[0, 0.49, z]} size={[2.25, 0.15, 0.16]} color="#252b30" />
          {[-1, 1].map((side) => (
            <Wheel key={side} position={[side * 1.12, 0.49, z]} side={side} spin={wheelRotation} />
          ))}
        </group>
      ))}
      {/* Sculpted cab-over body, roof fairing, and dark rubber window surrounds. */}
      <Panel position={[0, 1.39, 3.85]} size={[2.2, 1.12, 2.15]} color="#e9eef2" radius={0.12} />
      <Panel position={[0, 2.2, 3.65]} size={[2.16, 0.85, 1.72]} color="#f1f5f7" radius={0.14} />
      <Panel
        position={[0, 2.67, 3.4]}
        size={[2.12, 0.28, 1.46]}
        color="#dce5eb"
        radius={0.12}
        rotation={[-0.12, 0, 0]}
      />
      <Panel
        position={[0, 2.23, 4.48]}
        size={[1.96, 0.72, 0.065]}
        color="#15232d"
        radius={0.045}
        rotation={[-0.12, 0, 0]}
      />
      <Panel
        position={[0, 2.25, 4.523]}
        size={[1.8, 0.57, 0.025]}
        color="#385a6b"
        metalness={0.8}
        radius={0.025}
        rotation={[-0.12, 0, 0]}
      />
      <Panel position={[0, 2.23, 4.55]} size={[0.035, 0.62, 0.025]} color="#15232d" />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Panel
            position={[side * 1.085, 2.21, 3.66]}
            size={[0.035, 0.57, 1.27]}
            color="#203744"
            radius={0.014}
          />
          <Panel position={[side * 1.11, 1.62, 3.64]} size={[0.025, 0.46, 1.17]} color="#d2dde5" />
          <Panel
            position={[side * 1.13, 1.78, 3.18]}
            size={[0.04, 0.065, 0.22]}
            color="#29343e"
            radius={0.018}
          />
          <Panel position={[side * 1.27, 2.07, 4.22]} size={[0.37, 0.045, 0.055]} color="#242d35" />
          <Panel
            position={[side * 1.43, 2.2, 4.2]}
            size={[0.16, 0.43, 0.22]}
            color="#27313a"
            radius={0.055}
          />
          <Panel
            position={[side * 1.435, 2.2, 4.075]}
            size={[0.115, 0.34, 0.015]}
            color="#a6c0cc"
            metalness={0.95}
          />
          {[0.79, 0.99].map((y) => (
            <Panel
              key={y}
              position={[side * 1.06, y, 2.94]}
              size={[0.32, 0.08, 0.45]}
              color="#64727e"
            />
          ))}
          <mesh
            position={[side * 1.12, 0.49, 3.65]}
            rotation={[0, (side * Math.PI) / 2, 0]}
            castShadow
          >
            <torusGeometry args={[0.57, 0.095, 8, 24, Math.PI]} />
            <meshStandardMaterial color="#27333e" roughness={0.65} />
          </mesh>
          <Panel
            position={[side * 0.48, 2.04, 4.58]}
            size={[0.62, 0.028, 0.028]}
            color="#111a21"
            rotation={[0, 0, side * 0.12]}
          />
          <Panel
            position={[side * 0.81, 1.16, 4.94]}
            size={[0.48, 0.26, 0.055]}
            color="#25303a"
            radius={0.045}
          />
          <Lamp
            position={[side * 0.77, 1.19, 4.977]}
            size={[0.28, 0.115, 0.02]}
            color="#eff7ff"
            intensity={1.5}
          />
          <Lamp position={[side * 0.99, 1.19, 4.978]} size={[0.075, 0.115, 0.02]} color="#ffb347" />
          <Panel
            position={[side * 0.99, 0.67, 0.99]}
            size={[0.36, 0.47, 1.3]}
            color="#a0aab0"
            radius={0.09}
          />
          {[-2.6, -3.85].map((z) => (
            <Panel
              key={z}
              position={[side * 1.12, 1.06, z]}
              size={[0.44, 0.12, 1.15]}
              color="#303941"
              radius={0.05}
            />
          ))}
          <Panel position={[side * 1.12, 0.38, -4.43]} size={[0.4, 0.46, 0.06]} color="#171d24" />
        </group>
      ))}
      <Panel position={[0, 1.3, 4.945]} size={[1.02, 0.48, 0.04]} color="#111b24" radius={0.035} />
      {[1.14, 1.25, 1.36, 1.47].map((y) => (
        <Panel key={y} position={[0, y, 4.98]} size={[0.92, 0.025, 0.025]} color="#75848f" />
      ))}
      <Panel position={[0, 0.89, 4.87]} size={[2.16, 0.2, 0.24]} color="#71808b" radius={0.065} />
      <Panel position={[0, 0.91, 5.005]} size={[0.49, 0.135, 0.02]} color="#eac45e" />
      {/* Hollow cargo body lets the existing unloading animation reveal the interior. */}
      <Panel position={[0, 0.89, -1.2]} size={[2.3, 0.17, 7.2]} color="#66717c" />
      <Panel position={[0, 3.06, -1.2]} size={[2.34, 0.1, 7.24]} color="#e4eaee" />
      <Panel position={[0, 1.98, 2.36]} size={[2.3, 2.1, 0.08]} />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Panel position={[side * 1.12, 1.98, -1.2]} size={[0.07, 2.1, 7.2]} color="#cbd5dd" />
          {Array.from({ length: 24 }, (_, i) => (
            <Panel
              key={i}
              position={[side * 1.17, 2.06, -4.6 + i * 0.29]}
              size={[0.045, 1.85, 0.055]}
              color="#e0e6eb"
            />
          ))}
          <Panel position={[side * 1.18, 1.18, -1.2]} size={[0.04, 0.21, 7.15]} color="#087e96" />
          {[0.97, 3].map((y) => (
            <Panel
              key={y}
              position={[side * 1.18, y, -1.2]}
              size={[0.065, 0.065, 7.2]}
              color="#8998a5"
            />
          ))}
          {[-4.4, -2.3, 0, 2.1].map((z) => (
            <Lamp
              key={z}
              position={[side * 1.21, 1.02, z]}
              size={[0.025, 0.075, 0.16]}
              color="#ffac42"
            />
          ))}
          <group position={[side * 1.14, 1.98, -4.83]} rotation={[0, side * doorAngle, 0]}>
            <Panel position={[-side * 0.555, 0, 0]} size={[1.1, 2.05, 0.075]} color="#d1dae1" />
            {[-0.34, -0.79].map((offset) => (
              <Panel
                key={offset}
                position={[side * offset, 0, -0.065]}
                size={[0.035, 1.92, 0.04]}
                color="#7b8a97"
              />
            ))}
            {[-0.77, 0, 0.77].map((y) => (
              <Panel
                key={y}
                position={[-side * 0.08, y, -0.065]}
                size={[0.17, 0.08, 0.05]}
                color="#637482"
              />
            ))}
            <Panel
              position={[-side * 0.58, -0.34, -0.1]}
              size={[0.3, 0.055, 0.055]}
              color="#465560"
            />
          </group>
          <Lamp position={[side * 0.91, 0.79, -4.85]} size={[0.27, 0.14, 0.04]} color="#ee3e37" />
          <Lamp
            position={[side * 0.64, 0.79, -4.85]}
            size={[0.16, 0.14, 0.04]}
            color={isReversing ? "#f5faff" : "#73818d"}
            intensity={isReversing ? 1.7 : 0}
          />
        </group>
      ))}
      <Panel position={[0, 0.48, -4.83]} size={[2.12, 0.13, 0.18]} color="#98a5af" />
    </group>
  );
}
