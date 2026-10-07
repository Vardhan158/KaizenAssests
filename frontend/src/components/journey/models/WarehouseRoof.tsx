import { useMemo } from "react";
import * as THREE from "three";

interface WarehouseRoofProps {
  showWalls?: boolean;
}

// Prominent triangular pitch constants
const ROOF_WIDTH = 48; // Total building width (-24 to +24)
const HALF_WIDTH = 24; // Half-width from center to eave
const EAVE_Y = 10.0; // Eave height matching facade wall top
const RIDGE_RISE = 5.5; // Steep, prominent triangular peak rise
const RIDGE_Y = EAVE_Y + RIDGE_RISE; // 15.5m peak height
const SLOPE_ANGLE = Math.atan2(RIDGE_RISE, HALF_WIDTH); // ~12.9 deg (~0.225 rad)
const SLOPE_LENGTH = Math.sqrt(HALF_WIDTH * HALF_WIDTH + RIDGE_RISE * RIDGE_RISE); // ~24.62m
const MID_SLOPE_Y = EAVE_Y + RIDGE_RISE / 2; // 12.75m

function GableEnd({ z, isFront = true }: { z: number; isFront?: boolean }) {
  const gableShape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-HALF_WIDTH, 0);
    s.lineTo(0, RIDGE_RISE);
    s.lineTo(HALF_WIDTH, 0);
    s.lineTo(HALF_WIDTH, -0.05);
    s.lineTo(-HALF_WIDTH, -0.05);
    s.closePath();
    return s;
  }, []);

  const fasciaHalfX = HALF_WIDTH / 2;
  const fasciaMidY = RIDGE_RISE / 2;

  return (
    <group position={[0, EAVE_Y, z]}>
      {/* Bold Triangular Gable Wall Panel */}
      <mesh castShadow receiveShadow position={[0, 0, -0.6]}>
        <extrudeGeometry args={[gableShape, { depth: 1.2, bevelEnabled: false }]} />
        <meshStandardMaterial color="#d4dedb" roughness={0.7} metalness={0.15} />
      </mesh>

      {/* Left & Right Sloped Fascia Bargeboard Beams */}
      <mesh
        position={[-fasciaHalfX, fasciaMidY, isFront ? 0.64 : -0.64]}
        rotation={[0, 0, SLOPE_ANGLE]}
        castShadow
      >
        <boxGeometry args={[SLOPE_LENGTH + 0.3, 0.3, 0.18]} />
        <meshStandardMaterial color="#187d86" roughness={0.45} metalness={0.3} />
      </mesh>
      <mesh
        position={[fasciaHalfX, fasciaMidY, isFront ? 0.64 : -0.64]}
        rotation={[0, 0, -SLOPE_ANGLE]}
        castShadow
      >
        <boxGeometry args={[SLOPE_LENGTH + 0.3, 0.3, 0.18]} />
        <meshStandardMaterial color="#187d86" roughness={0.45} metalness={0.3} />
      </mesh>

      {/* Illuminated Edge Accent Strip on Triangular Rafters */}
      <mesh
        position={[-fasciaHalfX, fasciaMidY, isFront ? 0.74 : -0.74]}
        rotation={[0, 0, SLOPE_ANGLE]}
      >
        <boxGeometry args={[SLOPE_LENGTH + 0.2, 0.05, 0.05]} />
        <meshStandardMaterial color="#ffffff" emissive="#22d3ee" emissiveIntensity={2.0} />
      </mesh>
      <mesh
        position={[fasciaHalfX, fasciaMidY, isFront ? 0.74 : -0.74]}
        rotation={[0, 0, -SLOPE_ANGLE]}
      >
        <boxGeometry args={[SLOPE_LENGTH + 0.2, 0.05, 0.05]} />
        <meshStandardMaterial color="#ffffff" emissive="#22d3ee" emissiveIntensity={2.0} />
      </mesh>

      {/* Triangular Apex Cap & Aviation Warning Light */}
      <mesh position={[0, RIDGE_RISE + 0.14, isFront ? 0.68 : -0.68]}>
        <boxGeometry args={[1.4, 0.38, 0.16]} />
        <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.7} />
      </mesh>
      <mesh position={[0, RIDGE_RISE + 0.42, isFront ? 0.68 : -0.68]}>
        <cylinderGeometry args={[0.08, 0.08, 0.22, 12]} />
        <meshStandardMaterial color="#ffffff" emissive="#ef4444" emissiveIntensity={2.5} />
      </mesh>

      {/* Center Architectural Gable Vent / Louver Grille */}
      <group position={[0, 2.2, isFront ? 0.66 : -0.66]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.3, 1.3, 0.1, 24]} />
          <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.15, 1.15, 0.12, 24]} />
          <meshStandardMaterial color="#0284c7" emissive="#0284c7" emissiveIntensity={0.6} />
        </mesh>
        {/* Louver horizontal slats */}
        {[-0.6, -0.3, 0, 0.3, 0.6].map((sy) => (
          <mesh key={sy} position={[0, sy, isFront ? 0.06 : -0.06]}>
            <boxGeometry args={[Math.sqrt(Math.max(0.1, 1.1 - sy * sy)) * 2, 0.06, 0.04]} />
            <meshStandardMaterial color="#334155" metalness={0.7} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function WarehouseRoof({ showWalls = true }: WarehouseRoofProps) {
  // Skylight bays placed between structural roof trusses
  const skylightZPositions = [-15, -47.5, -82.5, -117.5, -152.5, -187.5, -222.5];

  // Structural roof truss Z coordinates (matching WarehouseBuilding columns)
  const trussZPositions = [-30, -65, -100, -135, -170, -205, -240];

  // Longitudinal structural purlins (underside ceiling support)
  const purlinConfigs = [
    { x: -18, y: EAVE_Y + (6 / 24) * RIDGE_RISE, rot: SLOPE_ANGLE },
    { x: -12, y: EAVE_Y + (12 / 24) * RIDGE_RISE, rot: SLOPE_ANGLE },
    { x: -6, y: EAVE_Y + (18 / 24) * RIDGE_RISE, rot: SLOPE_ANGLE },
    { x: 6, y: EAVE_Y + (18 / 24) * RIDGE_RISE, rot: -SLOPE_ANGLE },
    { x: 12, y: EAVE_Y + (12 / 24) * RIDGE_RISE, rot: -SLOPE_ANGLE },
    { x: 18, y: EAVE_Y + (6 / 24) * RIDGE_RISE, rot: -SLOPE_ANGLE },
  ];

  const slopeMidX = HALF_WIDTH / 2;

  return (
    <group>
      {/* ─── PROMINENT TRIANGULAR GABLES (FRONT & REAR) ─── */}
      <GableEnd z={0} isFront={true} />
      <GableEnd z={-245} isFront={false} />

      {/* ─── MAIN TRIANGULAR PITCH ROOF SLOPES ─── */}
      {/* Left Roof Slope (pitch angle ~12.9 deg) */}
      <mesh
        position={[-slopeMidX, MID_SLOPE_Y, -122.5]}
        rotation={[0, 0, SLOPE_ANGLE]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[SLOPE_LENGTH + 0.4, 0.16, 246.2]} />
        <meshStandardMaterial
          color="#374151"
          roughness={0.65}
          metalness={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Right Roof Slope */}
      <mesh
        position={[slopeMidX, MID_SLOPE_Y, -122.5]}
        rotation={[0, 0, -SLOPE_ANGLE]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[SLOPE_LENGTH + 0.4, 0.16, 246.2]} />
        <meshStandardMaterial
          color="#374151"
          roughness={0.65}
          metalness={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ─── PEAK RIDGE CAP & INDUSTRIAL RIDGE VENTILATOR ─── */}
      <mesh position={[0, RIDGE_Y + 0.08, -122.5]} castShadow>
        <boxGeometry args={[1.5, 0.24, 246.6]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0, RIDGE_Y + 0.18, -122.5]}>
        <boxGeometry args={[0.7, 0.12, 245.0]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
      </mesh>

      {/* Aerodynamic rooftop ventilator units along the high triangular ridge */}
      {[-30, -70, -110, -150, -190, -230].map((vz) => (
        <group key={vz} position={[0, RIDGE_Y + 0.35, vz]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.75, 0.95, 0.5, 12]} />
            <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.32, 0]}>
            <cylinderGeometry args={[1.1, 0.7, 0.16, 12]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.2} />
          </mesh>
        </group>
      ))}

      {/* ─── STRUCTURAL A-FRAME TRUSS WEBBING (CEILING VAULT) ─── */}
      {trussZPositions.map((tz) => (
        <group key={tz} position={[0, 0, tz]}>
          {/* Left Sloped Rafter Beam */}
          <mesh
            position={[-11.5, 12.35, 0]}
            rotation={[0, 0, SLOPE_ANGLE]}
            castShadow
          >
            <boxGeometry args={[23.6, 0.45, 0.45]} />
            <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
          </mesh>

          {/* Right Sloped Rafter Beam */}
          <mesh
            position={[11.5, 12.35, 0]}
            rotation={[0, 0, -SLOPE_ANGLE]}
            castShadow
          >
            <boxGeometry args={[23.6, 0.45, 0.45]} />
            <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
          </mesh>

          {/* Central King Post Strut (from Y: 9.5 crossbeam up to Y: 15.3 ridge) */}
          <mesh position={[0, 12.4, 0]} castShadow>
            <boxGeometry args={[0.45, 5.8, 0.45]} />
            <meshStandardMaterial color="#427985" metalness={0.5} roughness={0.45} />
          </mesh>

          {/* Queen Struts Left & Right */}
          {[-8, 8].map((qx) => (
            <mesh key={qx} position={[qx, 11.6, 0]} castShadow>
              <boxGeometry args={[0.35, 4.2, 0.35]} />
              <meshStandardMaterial color="#427985" metalness={0.5} roughness={0.45} />
            </mesh>
          ))}
          {[-16, 16].map((qx) => (
            <mesh key={qx} position={[qx, 10.5, 0]} castShadow>
              <boxGeometry args={[0.35, 2.0, 0.35]} />
              <meshStandardMaterial color="#427985" metalness={0.5} roughness={0.45} />
            </mesh>
          ))}
        </group>
      ))}

      {/* ─── TRANSLUCENT INDUSTRIAL SKYLIGHT RIBBONS ON TRIANGULAR SLOPES ─── */}
      {skylightZPositions.map((sz) => (
        <group key={sz} position={[0, 0, sz]}>
          {/* Left Skylight Panel */}
          <mesh position={[-10.0, 12.3, 0]} rotation={[0, 0, SLOPE_ANGLE]}>
            <boxGeometry args={[5.2, 0.2, 12.0]} />
            <meshStandardMaterial
              color="#7dd3fc"
              emissive="#38bdf8"
              emissiveIntensity={0.35}
              roughness={0.25}
              transparent
              opacity={0.65}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Left Skylight Frame Gasket */}
          <mesh position={[-10.0, 12.31, 0]} rotation={[0, 0, SLOPE_ANGLE]}>
            <boxGeometry args={[5.45, 0.14, 12.25]} />
            <meshBasicMaterial color="#0f172a" wireframe transparent opacity={0.6} />
          </mesh>

          {/* Right Skylight Panel */}
          <mesh position={[10.0, 12.3, 0]} rotation={[0, 0, -SLOPE_ANGLE]}>
            <boxGeometry args={[5.2, 0.2, 12.0]} />
            <meshStandardMaterial
              color="#7dd3fc"
              emissive="#38bdf8"
              emissiveIntensity={0.35}
              roughness={0.25}
              transparent
              opacity={0.65}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Right Skylight Frame Gasket */}
          <mesh position={[10.0, 12.31, 0]} rotation={[0, 0, -SLOPE_ANGLE]}>
            <boxGeometry args={[5.45, 0.14, 12.25]} />
            <meshBasicMaterial color="#0f172a" wireframe transparent opacity={0.6} />
          </mesh>
        </group>
      ))}

      {/* ─── LONGITUDINAL ROOF PURLINS (INTERIOR CEILING VIEW) ─── */}
      {purlinConfigs.map((cfg, i) => (
        <mesh
          key={i}
          position={[cfg.x, cfg.y - 0.18, -122.5]}
          rotation={[0, 0, cfg.rot]}
          castShadow
        >
          <boxGeometry args={[0.24, 0.4, 245.0]} />
          <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      {/* ─── BUILDING EXTERIOR SIDE & REAR WALLS ─── */}
      {showWalls && (
        <group>
          {/* Left Side Wall (X = -24) */}
          <group position={[-24, 0, -122.5]}>
            {/* Teal Plinth Base */}
            <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.3, 1.7, 245.0]} />
              <meshStandardMaterial color="#247984" roughness={0.55} />
            </mesh>
            {/* Upper Light Grey Cladding */}
            <mesh position={[0, 5.85, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.26, 8.3, 245.0]} />
              <meshStandardMaterial color="#d4dedb" roughness={0.7} metalness={0.15} />
            </mesh>
            {/* Clerestory Daylight Window Ribbon */}
            <mesh position={[0, 8.3, 0]}>
              <boxGeometry args={[0.3, 1.4, 243.0]} />
              <meshStandardMaterial
                color="#0284c7"
                emissive="#0369a1"
                emissiveIntensity={0.25}
                transparent
                opacity={0.45}
                roughness={0.2}
              />
            </mesh>
          </group>

          {/* Right Side Wall (X = +24) */}
          <group position={[24, 0, -122.5]}>
            {/* Teal Plinth Base */}
            <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.3, 1.7, 245.0]} />
              <meshStandardMaterial color="#247984" roughness={0.55} />
            </mesh>
            {/* Upper Light Grey consultant cladding */}
            <mesh position={[0, 5.85, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.26, 8.3, 245.0]} />
              <meshStandardMaterial color="#d4dedb" roughness={0.7} metalness={0.15} />
            </mesh>
            {/* Clerestory Daylight Window Ribbon */}
            <mesh position={[0, 8.3, 0]}>
              <boxGeometry args={[0.3, 1.4, 243.0]} />
              <meshStandardMaterial
                color="#0284c7"
                emissive="#0369a1"
                emissiveIntensity={0.25}
                transparent
                opacity={0.45}
                roughness={0.2}
              />
            </mesh>
          </group>
        </group>
      )}
    </group>
  );
}
