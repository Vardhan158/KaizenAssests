import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

interface WarehouseForkliftProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  forkLiftProgress?: number; // 0 to 1 (fork height)
}

export function WarehouseForklift({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  forkLiftProgress = 0,
}: WarehouseForkliftProps) {
  const forksCarriageRef = useRef<THREE.Group>(null);
  const innerMastRef = useRef<THREE.Group>(null);
  const leftPistonRef = useRef<THREE.Mesh>(null);
  const rightPistonRef = useRef<THREE.Mesh>(null);
  const beaconLightRef = useRef<THREE.PointLight>(null);
  const beaconMeshRef = useRef<THREE.Mesh>(null);

  // Synchronized kinematic elevation & dynamic safety strobe
  useFrame(({ clock }) => {
    // 1. Carriage vertical elevation (Y: 0.15 to Y: 2.8) - exact height required for pallet pickup
    const carriageY = 0.15 + forkLiftProgress * 2.65;
    if (forksCarriageRef.current) {
      forksCarriageRef.current.position.y = carriageY;
    }

    // 2. Telescopic inner mast elevation (realistic 2-stage duplex mast behavior)
    if (innerMastRef.current) {
      innerMastRef.current.position.y = 1.5 + Math.max(0, forkLiftProgress - 0.25) * 1.35;
    }

    // 3. Hydraulic lift cylinder chrome rod extension
    const pistonScale = 1 + forkLiftProgress * 1.6;
    if (leftPistonRef.current) leftPistonRef.current.scale.y = pistonScale;
    if (rightPistonRef.current) rightPistonRef.current.scale.y = pistonScale;

    // 4. Rotating amber warning beacon strobe pulse
    const t = clock.getElapsedTime();
    const strobe = (Math.sin(t * 12) + 1) * 0.5;
    if (beaconLightRef.current) {
      beaconLightRef.current.intensity = 1.2 + strobe * 2.8;
    }
    if (beaconMeshRef.current) {
      const mat = beaconMeshRef.current.material as THREE.MeshStandardMaterial;
      if (mat) mat.emissiveIntensity = 1.5 + strobe * 3.5;
    }
  });

  return (
    <group position={position} rotation={rotation}>
      {/* ══════════════════════════════════════════════════════════════════
          1. CHASSIS, BATTERY HOOD & COUNTERWEIGHT
          ══════════════════════════════════════════════════════════════════ */}
      {/* Heavy Lower Steel Frame Chassis */}
      <mesh position={[0, 0.38, -0.15]} castShadow receiveShadow>
        <boxGeometry args={[1.34, 0.44, 2.05]} />
        <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.3} />
      </mesh>

      {/* Main Ergonomic Body Shell (Industrial High-Visibility Safety Orange) */}
      <mesh position={[0, 0.72, -0.18]} castShadow receiveShadow>
        <boxGeometry args={[1.32, 0.48, 1.65]} />
        <meshStandardMaterial color="#f97316" metalness={0.35} roughness={0.4} />
      </mesh>

      {/* High-Gloss Beveled Battery Hood (Rear Cowl) */}
      <mesh position={[0, 0.94, -0.52]} castShadow receiveShadow>
        <boxGeometry args={[1.18, 0.28, 0.95]} />
        <meshStandardMaterial color="#ea580c" metalness={0.4} roughness={0.35} />
      </mesh>

      {/* Dual Side Ventilation Louvers / Heat Grilles */}
      {[-0.67, 0.67].map((gx, idx) => (
        <group key={`grille-${idx}`} position={[gx, 0.72, -0.4]}>
          {[-0.12, 0, 0.12].map((gz, j) => (
            <mesh key={`slot-${j}`} position={[0, gz, 0]}>
              <boxGeometry args={[0.02, 0.05, 0.42]} />
              <meshStandardMaterial color="#020617" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Left & Right Ergonomic Cab Entry Steps with Anti-Slip Treads */}
      {[-0.69, 0.69].map((sx, idx) => (
        <group key={`step-${idx}`} position={[sx, 0.26, 0.12]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.14, 0.06, 0.44]} />
            <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* Perforated Non-Slip Metal Tread */}
          <mesh position={[0, 0.035, 0]}>
            <boxGeometry args={[0.12, 0.015, 0.4]} />
            <meshStandardMaterial color="#090d16" roughness={0.95} />
          </mesh>
        </group>
      ))}

      {/* ─── SCULPTED REAR CAST-IRON COUNTERWEIGHT ─── */}
      <group position={[0, 0.68, -1.18]}>
        {/* Main Curved Heavy Ballast */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.34, 0.78, 0.52]} />
          <meshStandardMaterial color="#1e293b" metalness={0.75} roughness={0.35} />
        </mesh>

        {/* Lower Chamfered Radiused Bumper Base */}
        <mesh position={[0, -0.32, 0.06]} castShadow receiveShadow>
          <boxGeometry args={[1.28, 0.2, 0.5]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.3} />
        </mesh>

        {/* Heavy-Duty Towing Drawbar Hitch & Pin */}
        <group position={[0, -0.16, -0.27]}>
          <mesh castShadow>
            <boxGeometry args={[0.22, 0.24, 0.12]} />
            <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.28, 12]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.1} />
          </mesh>
        </group>

        {/* Rear Multi-Element LED Taillights (Red Brakes + White Backup) */}
        {[-0.48, 0.48].map((lx, idx) => (
          <group key={`taillight-${idx}`} position={[lx, 0.15, -0.27]}>
            {/* Lamp Housing */}
            <mesh>
              <boxGeometry args={[0.22, 0.12, 0.04]} />
              <meshStandardMaterial color="#090d16" roughness={0.7} />
            </mesh>
            {/* Red LED Brake Cluster */}
            <mesh position={[-0.045, 0, 0.015]}>
              <boxGeometry args={[0.1, 0.08, 0.02]} />
              <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={3} />
            </mesh>
            {/* White LED Reverse Lamp */}
            <mesh position={[0.055, 0, 0.015]}>
              <boxGeometry args={[0.07, 0.08, 0.02]} />
              <meshStandardMaterial color="#f8fafc" emissive="#ffffff" emissiveIntensity={2.5} />
            </mesh>
          </group>
        ))}

        {/* Reflective Safety Chevron Warning Stripes */}
        <group position={[0, -0.15, -0.27]}>
          {[-0.38, -0.22, -0.06, 0.1, 0.26].map((cx, i) => (
            <mesh key={`chev-${i}`} position={[cx, 0, 0.005]} rotation={[0, 0, 0.6]}>
              <boxGeometry args={[0.06, 0.24, 0.01]} />
              <meshStandardMaterial
                color={i % 2 === 0 ? "#facc15" : "#090d16"}
                emissive={i % 2 === 0 ? "#eab308" : "#000000"}
                emissiveIntensity={i % 2 === 0 ? 0.6 : 0}
              />
            </mesh>
          ))}
        </group>

        {/* High-Resolution Fleet ID Plate: "NEXUS FL-04 • 3.5T" */}
        <mesh position={[0, 0.26, -0.27]}>
          <boxGeometry args={[0.62, 0.14, 0.02]} />
          <meshStandardMaterial color="#020617" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.26, -0.282]}>
          <planeGeometry args={[0.58, 0.1]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={1.2} />
        </mesh>
      </group>

      {/* ══════════════════════════════════════════════════════════════════
          2. OPERATOR COCKPIT & CONTROLS
          ══════════════════════════════════════════════════════════════════ */}
      {/* Operator Floor Platform */}
      <mesh position={[0, 0.58, 0.1]} castShadow receiveShadow>
        <boxGeometry args={[1.05, 0.05, 0.8]} />
        <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.5} />
      </mesh>
      {/* Ribbed Anti-Slip Rubber Floor Mat */}
      <mesh position={[0, 0.61, 0.1]}>
        <boxGeometry args={[0.95, 0.01, 0.7]} />
        <meshStandardMaterial color="#090d16" roughness={0.98} />
      </mesh>

      {/* Dual Foot Pedals (Accelerator & Inching/Brake Pedals) */}
      {[-0.18, 0.16].map((px, idx) => (
        <group key={`pedal-${idx}`} position={[px, 0.65, 0.38]} rotation={[0.4, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.09, 0.02, 0.14]} />
            <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* ─── ERGONOMIC OPERATOR SUSPENSION BUCKET SEAT ─── */}
      <group position={[0, 0.62, -0.15]}>
        {/* Heavy Suspension Base Pedestal */}
        <mesh position={[0, 0.14, 0]} castShadow>
          <boxGeometry args={[0.44, 0.26, 0.44]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} />
        </mesh>
        {/* Contoured Foam Seat Cushion */}
        <mesh position={[0, 0.3, 0.02]} castShadow receiveShadow>
          <boxGeometry args={[0.52, 0.1, 0.48]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} metalness={0.2} />
        </mesh>
        {/* High Ergonomic Lumbar Backrest */}
        <mesh position={[0, 0.58, -0.2]} rotation={[-0.1, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.5, 0.52, 0.1]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} metalness={0.2} />
        </mesh>
        {/* Adjustable Headrest */}
        <mesh position={[0, 0.88, -0.23]} castShadow>
          <boxGeometry args={[0.3, 0.16, 0.08]} />
          <meshStandardMaterial color="#334155" roughness={0.8} metalness={0.2} />
        </mesh>
        {/* Right Armrest with Integrated Fingertip Hydraulic Mini-Levers */}
        <group position={[0.32, 0.52, -0.05]}>
          <mesh castShadow>
            <boxGeometry args={[0.1, 0.06, 0.36]} />
            <meshStandardMaterial color="#0f172a" roughness={0.6} />
          </mesh>
          {/* 3 Fingertip Hydraulic Control Toggles */}
          {[-0.08, 0, 0.08].map((tz, i) => (
            <mesh key={`toggle-${i}`} position={[0, 0.045, tz]}>
              <cylinderGeometry args={[0.008, 0.008, 0.05, 8]} />
              <meshStandardMaterial color={i === 0 ? "#38bdf8" : i === 1 ? "#f59e0b" : "#10b981"} />
            </mesh>
          ))}
        </group>
      </group>

      {/* ─── STEERING COLUMN & DIGITAL INSTRUMENT CONSOLE ─── */}
      <group position={[0, 0.72, 0.42]}>
        {/* Slanted Steering Console Pillar */}
        <mesh position={[0, 0.28, 0]} rotation={[-0.32, 0, 0]} castShadow>
          <boxGeometry args={[0.38, 0.52, 0.22]} />
          <meshStandardMaterial color="#0f172a" metalness={0.5} roughness={0.5} />
        </mesh>

        {/* Digital Telemetry Display Screen (Glowing LCD with Live Battery & Speed) */}
        <mesh position={[0, 0.52, -0.08]} rotation={[-0.7, 0, 0]}>
          <planeGeometry args={[0.26, 0.14]} />
          <meshStandardMaterial
            color="#0284c7"
            emissive="#06b6d4"
            emissiveIntensity={2.5}
            roughness={0.2}
          />
        </mesh>

        {/* 3 Traditional Floor/Console Hydraulic Levers (Lift, Tilt, Side-Shift) */}
        {[-0.08, 0, 0.08].map((lx, i) => (
          <group key={`lever-${i}`} position={[lx, 0.48, 0.02]} rotation={[-0.2, 0, 0]}>
            <mesh>
              <cylinderGeometry args={[0.008, 0.008, 0.18, 8]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
            </mesh>
            <mesh position={[0, 0.1, 0]}>
              <sphereGeometry args={[0.022, 10, 10]} />
              <meshStandardMaterial
                color={i === 0 ? "#0284c7" : i === 1 ? "#ea580c" : "#10b981"}
                roughness={0.3}
              />
            </mesh>
          </group>
        ))}

        {/* Steering Shaft & Wheel */}
        <group position={[0, 0.56, -0.02]} rotation={[-0.55, 0, 0]}>
          {/* Center Column Shaft */}
          <mesh>
            <cylinderGeometry args={[0.025, 0.025, 0.14, 12]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} />
          </mesh>
          {/* 3-Spoke Sport/Industrial Steering Wheel Rim */}
          <group position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh castShadow>
              <torusGeometry args={[0.18, 0.022, 12, 24]} />
              <meshStandardMaterial color="#090d16" roughness={0.7} />
            </mesh>
            {/* Center Horn Cap & Brand Logo */}
            <mesh>
              <cylinderGeometry args={[0.06, 0.06, 0.03, 16]} />
              <meshStandardMaterial color="#0284c7" metalness={0.6} />
            </mesh>
            {/* 3 Radial Spokes */}
            {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((rad, i) => (
              <mesh key={`spoke-${i}`} rotation={[0, 0, rad]}>
                <boxGeometry args={[0.18, 0.02, 0.012]} />
                <meshStandardMaterial color="#475569" metalness={0.8} />
              </mesh>
            ))}
            {/* Iconic Industrial Steering Spinner Knob ("Suicide Knob") */}
            <mesh position={[0.14, 0.04, 0.04]}>
              <sphereGeometry args={[0.03, 12, 12]} />
              <meshStandardMaterial color="#38bdf8" roughness={0.3} />
            </mesh>
          </group>
        </group>
      </group>

      {/* ══════════════════════════════════════════════════════════════════
          3. HEAVY-DUTY FOPS/ROPS OVERHEAD SAFETY GUARD & LIGHTING
          ══════════════════════════════════════════════════════════════════ */}
      <group position={[0, 1.82, -0.25]}>
        {/* 4 Tubular Curved Steel Safety Pillars (FOPS Certified) */}
        {[-0.56, 0.56].map((cx, i) =>
          [-0.68, 0.64].map((cz, j) => (
            <mesh
              key={`pillar-${i}-${j}`}
              position={[cx, 0, cz]}
              rotation={[cz > 0 ? 0.08 : -0.04, 0, cx > 0 ? -0.03 : 0.03]}
              castShadow
            >
              <cylinderGeometry args={[0.036, 0.04, 1.45, 12]} />
              <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.25} />
            </mesh>
          ))
        )}

        {/* Heavy Overhead Welded Steel Safety Protective Canopy */}
        <group position={[0, 0.72, 0]}>
          {/* Outer Perimeter Frame */}
          <mesh castShadow>
            <boxGeometry args={[1.26, 0.07, 1.48]} />
            <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.2} />
          </mesh>
          {/* 7 Overhead High-Strength Steel Transverse Bars */}
          {[-0.5, -0.34, -0.18, -0.02, 0.14, 0.3, 0.46].map((bz, idx) => (
            <mesh key={`grid-${idx}`} position={[0, 0.01, bz]} castShadow>
              <boxGeometry args={[1.14, 0.045, 0.035]} />
              <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
            </mesh>
          ))}
          {/* Protective Tinted Polycarbonate Rain/Debris Roof Insert */}
          <mesh position={[0, 0.045, 0]}>
            <planeGeometry args={[1.15, 1.35]} />
            <meshStandardMaterial
              color="#38bdf8"
              metalness={0.9}
              roughness={0.1}
              transparent
              opacity={0.3}
            />
          </mesh>
        </group>

        {/* ─── TWIN FRONT HIGH-POWER LED WORK LIGHTS ─── */}
        {[-0.44, 0.44].map((lx, idx) => (
          <group key={`worklight-${idx}`} position={[lx, 0.66, 0.74]}>
            <mesh castShadow>
              <boxGeometry args={[0.12, 0.1, 0.08]} />
              <meshStandardMaterial color="#020617" roughness={0.6} />
            </mesh>
            <mesh position={[0, 0, 0.042]}>
              <planeGeometry args={[0.1, 0.08]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive="#38bdf8"
                emissiveIntensity={4.0}
              />
            </mesh>
            {/* Forward Illumination Beam */}
            <pointLight
              position={[0, 0, 0.8]}
              color="#e0f2fe"
              intensity={2.8}
              distance={16}
              decay={1.8}
            />
          </group>
        ))}

        {/* ─── DUAL PANORAMIC REARVIEW MIRRORS ─── */}
        {[-0.62, 0.62].map((mx, idx) => (
          <group key={`mirror-${idx}`} position={[mx, 0.52, 0.62]} rotation={[0, mx > 0 ? -0.4 : 0.4, 0]}>
            {/* Bracket */}
            <mesh>
              <boxGeometry args={[0.08, 0.02, 0.02]} />
              <meshStandardMaterial color="#0f172a" metalness={0.8} />
            </mesh>
            {/* Mirror Housing */}
            <mesh position={[mx > 0 ? 0.04 : -0.04, 0, 0]} castShadow>
              <boxGeometry args={[0.03, 0.18, 0.1]} />
              <meshStandardMaterial color="#090d16" roughness={0.5} />
            </mesh>
            {/* Reflective Mirror Glass */}
            <mesh position={[mx > 0 ? 0.056 : -0.056, 0, 0]} rotation={[0, mx > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
              <planeGeometry args={[0.08, 0.16]} />
              <meshStandardMaterial color="#ffffff" metalness={0.98} roughness={0.05} />
            </mesh>
          </group>
        ))}

        {/* ─── FLASHING AMBER SAFETY BEACON (STROBE) ─── */}
        <group position={[0, 0.85, -0.42]}>
          {/* Pedestal Mount */}
          <mesh castShadow>
            <cylinderGeometry args={[0.07, 0.08, 0.06, 16]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} />
          </mesh>
          {/* Amber Fluted Fresnel Strobe Lens */}
          <mesh position={[0, 0.08, 0]} ref={beaconMeshRef} castShadow>
            <cylinderGeometry args={[0.075, 0.075, 0.12, 16]} />
            <meshStandardMaterial
              color="#fbbf24"
              emissive="#f59e0b"
              emissiveIntensity={2.5}
              roughness={0.2}
              transparent
              opacity={0.9}
            />
          </mesh>
          <pointLight
            ref={beaconLightRef}
            position={[0, 0.18, 0]}
            color="#f59e0b"
            intensity={2.5}
            distance={10}
            decay={2}
          />
        </group>

        {/* Modern Warehouse Blue Safety Floor Spotlight (Casts blue spot behind forklift) */}
        <pointLight position={[0, 0.4, -0.7]} color="#0284c7" intensity={2.0} distance={6} />
      </group>

      {/* ══════════════════════════════════════════════════════════════════
          4. 2-STAGE TELESCOPIC DUPLEX MAST & HYDRAULIC CYLINDERS
          ══════════════════════════════════════════════════════════════════ */}
      {/* ─── DUAL HYDRAULIC TILT CYLINDERS (Connecting Lower Mast to Chassis) ─── */}
      {[-0.34, 0.34].map((tx, idx) => (
        <group key={`tilt-${idx}`} position={[tx, 0.42, 0.58]} rotation={[-0.2, 0, 0]}>
          {/* Cylinder Barrel */}
          <mesh castShadow>
            <cylinderGeometry args={[0.045, 0.045, 0.32, 12]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Chrome Piston Rod */}
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.024, 0.024, 0.22, 12]} />
            <meshStandardMaterial color="#ffffff" metalness={0.98} roughness={0.05} />
          </mesh>
        </group>
      ))}

      {/* ─── OUTER FIXED MAST (Stage 1 Outer Rails) ─── */}
      <group position={[0, 1.5, 0.82]}>
        {/* Left Outer Heavy Steel I-Beam Column */}
        <mesh position={[-0.45, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.09, 3.05, 0.14]} />
          <meshStandardMaterial color="#1e293b" metalness={0.85} roughness={0.25} />
        </mesh>
        {/* Right Outer Heavy Steel I-Beam Column */}
        <mesh position={[0.45, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.09, 3.05, 0.14]} />
          <meshStandardMaterial color="#1e293b" metalness={0.85} roughness={0.25} />
        </mesh>
        {/* Lower Cross Tie Beam */}
        <mesh position={[0, -1.35, -0.02]} castShadow>
          <boxGeometry args={[0.9, 0.14, 0.08]} />
          <meshStandardMaterial color="#0f172a" metalness={0.85} />
        </mesh>
        {/* Top Heavy Steel Cross Arch */}
        <mesh position={[0, 1.48, -0.02]} castShadow>
          <boxGeometry args={[0.92, 0.12, 0.08]} />
          <meshStandardMaterial color="#f97316" metalness={0.4} />
        </mesh>
      </group>

      {/* ─── INNER TELESCOPIC MOVING MAST (Stage 2 Inner Rails) ─── */}
      <group position={[0, 1.5, 0.85]} ref={innerMastRef}>
        {/* Left Inner Channel Rail */}
        <mesh position={[-0.37, 0, 0]} castShadow>
          <boxGeometry args={[0.07, 2.9, 0.1]} />
          <meshStandardMaterial color="#334155" metalness={0.85} roughness={0.2} />
        </mesh>
        {/* Right Inner Channel Rail */}
        <mesh position={[0.37, 0, 0]} castShadow>
          <boxGeometry args={[0.07, 2.9, 0.1]} />
          <meshStandardMaterial color="#334155" metalness={0.85} roughness={0.2} />
        </mesh>
        {/* Top Inner Cross Tie & Chain Pulleys */}
        <mesh position={[0, 1.4, 0]} castShadow>
          <boxGeometry args={[0.76, 0.1, 0.07]} />
          <meshStandardMaterial color="#334155" metalness={0.85} />
        </mesh>
        {/* Twin Leaf Chain Guide Pulleys */}
        {[-0.24, 0.24].map((px, idx) => (
          <group key={`pulley-${idx}`} position={[px, 1.4, 0.05]} rotation={[0, 0, Math.PI / 2]}>
            <mesh>
              <cylinderGeometry args={[0.07, 0.07, 0.04, 16]} />
              <meshStandardMaterial color="#64748b" metalness={0.9} roughness={0.2} />
            </mesh>
          </group>
        ))}

        {/* ─── DUAL CENTRAL HYDRAULIC LIFT CYLINDERS ─── */}
        {[-0.22, 0.22].map((cx, idx) => (
          <group key={`lift-cyl-${idx}`} position={[cx, -0.4, -0.02]}>
            {/* Cylinder Outer Black Barrel */}
            <mesh castShadow>
              <cylinderGeometry args={[0.042, 0.042, 1.7, 16]} />
              <meshStandardMaterial color="#090d16" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Mirror Chrome High-Pressure Piston Shaft */}
            <mesh
              ref={idx === 0 ? leftPistonRef : rightPistonRef}
              position={[0, 0.9, 0]}
            >
              <cylinderGeometry args={[0.026, 0.026, 1.5, 16]} />
              <meshStandardMaterial
                color="#ffffff"
                metalness={0.98}
                roughness={0.04}
              />
            </mesh>
          </group>
        ))}

        {/* Twin Heavy Leaf Chains (running from cylinders over pulleys to carriage) */}
        {[-0.24, 0.24].map((chx, idx) => (
          <mesh key={`chain-${idx}`} position={[chx, 0.45, 0.06]}>
            <boxGeometry args={[0.025, 1.9, 0.02]} />
            <meshStandardMaterial color="#475569" metalness={0.9} roughness={0.3} />
          </mesh>
        ))}
      </group>

      {/* ══════════════════════════════════════════════════════════════════
          5. ELEVATING FORK CARRIAGE, LOAD BACKREST & TAPERED FORKS
          ══════════════════════════════════════════════════════════════════ */}
      <group position={[0, 0, 0.94]} ref={forksCarriageRef}>
        {/* Heavy Steel Carriage Plate (ISO Class Mounting Notches) */}
        <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.96, 0.38, 0.07]} />
          <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.3} />
        </mesh>
        {/* Upper & Lower Beveled Fork Mounting Notch Rails */}
        <mesh position={[0, 0.54, 0.015]} castShadow>
          <boxGeometry args={[0.94, 0.05, 0.04]} />
          <meshStandardMaterial color="#334155" metalness={0.9} />
        </mesh>
        <mesh position={[0, 0.22, 0.015]} castShadow>
          <boxGeometry args={[0.94, 0.05, 0.04]} />
          <meshStandardMaterial color="#334155" metalness={0.9} />
        </mesh>

        {/* ─── TALL LOAD BACKREST EXTENSION (Safety Lattice Grid) ─── */}
        <group position={[0, 0.88, -0.01]}>
          {/* Left & Right Main Upright Tubes */}
          {[-0.45, 0.45].map((bx, idx) => (
            <mesh key={`backrest-post-${idx}`} position={[bx, 0, 0]} castShadow>
              <boxGeometry args={[0.045, 0.86, 0.04]} />
              <meshStandardMaterial color="#0f172a" metalness={0.85} />
            </mesh>
          ))}
          {/* Top Cross Header */}
          <mesh position={[0, 0.41, 0]} castShadow>
            <boxGeometry args={[0.94, 0.05, 0.04]} />
            <meshStandardMaterial color="#0f172a" metalness={0.85} />
          </mesh>
          {/* 5 Welded Steel Vertical Safety Grid Bars */}
          {[-0.3, -0.15, 0, 0.15, 0.3].map((gx, idx) => (
            <mesh key={`bar-${idx}`} position={[gx, 0, 0]} castShadow>
              <boxGeometry args={[0.022, 0.82, 0.02]} />
              <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.25} />
            </mesh>
          ))}
        </group>

        {/* Pallet Alignment Laser Guide (Modern Visual Docking Beam) */}
        <mesh position={[0, 0.38, 0.06]}>
          <boxGeometry args={[0.08, 0.04, 0.03]} />
          <meshStandardMaterial color="#06b6d4" emissive="#22d3ee" emissiveIntensity={3} />
        </mesh>

        {/* ─── HEAVY-DUTY FORGED ALLOY STEEL FORK TINES ─── */}
        {/* Left Fork Blade (Positioned at X: -0.26 for perfect Euro/Standard pallet entry) */}
        <group position={[-0.26, 0, 0]}>
          {/* Vertical Shank (with top locking hook) */}
          <mesh position={[0, 0.25, 0.02]} castShadow receiveShadow>
            <boxGeometry args={[0.1, 0.48, 0.045]} />
            <meshStandardMaterial color="#475569" metalness={0.92} roughness={0.2} />
          </mesh>
          {/* Reinforced 90-Degree Forged Solid Heel */}
          <mesh position={[0, 0.045, 0.045]} castShadow>
            <boxGeometry args={[0.1, 0.07, 0.09]} />
            <meshStandardMaterial color="#334155" metalness={0.92} roughness={0.2} />
          </mesh>
          {/* Horizontal Tapered Fork Blade (1.2m long) */}
          <mesh position={[0, 0.035, 0.64]} castShadow receiveShadow>
            <boxGeometry args={[0.1, 0.042, 1.22]} />
            <meshStandardMaterial color="#64748b" metalness={0.92} roughness={0.18} />
          </mesh>
          {/* Beveled Front Entry Tip for Smooth Pallet Slotting */}
          <mesh position={[0, 0.026, 1.28]} rotation={[0.24, 0, 0]} castShadow>
            <boxGeometry args={[0.098, 0.024, 0.08]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.92} roughness={0.18} />
          </mesh>
        </group>

        {/* Right Fork Blade (Positioned at X: +0.26) */}
        <group position={[0.26, 0, 0]}>
          {/* Vertical Shank */}
          <mesh position={[0, 0.25, 0.02]} castShadow receiveShadow>
            <boxGeometry args={[0.1, 0.48, 0.045]} />
            <meshStandardMaterial color="#475569" metalness={0.92} roughness={0.2} />
          </mesh>
          {/* Reinforced 90-Degree Forged Solid Heel */}
          <mesh position={[0, 0.045, 0.045]} castShadow>
            <boxGeometry args={[0.1, 0.07, 0.09]} />
            <meshStandardMaterial color="#334155" metalness={0.92} roughness={0.2} />
          </mesh>
          {/* Horizontal Tapered Fork Blade (1.2m long) */}
          <mesh position={[0, 0.035, 0.64]} castShadow receiveShadow>
            <boxGeometry args={[0.1, 0.042, 1.22]} />
            <meshStandardMaterial color="#64748b" metalness={0.92} roughness={0.18} />
          </mesh>
          {/* Beveled Front Entry Tip */}
          <mesh position={[0, 0.026, 1.28]} rotation={[0.24, 0, 0]} castShadow>
            <boxGeometry args={[0.098, 0.024, 0.08]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.92} roughness={0.18} />
          </mesh>
        </group>
      </group>

      {/* ══════════════════════════════════════════════════════════════════
          6. INDUSTRIAL WHEELS, STEEL HUBS & LUG NUTS
          ══════════════════════════════════════════════════════════════════ */}
      {/* FRONT LARGE DRIVE WHEELS (Heavy Solid Cushion Rubber Tires) */}
      {[-0.62, 0.62].map((wx, idx) => (
        <group key={`front-wheel-${idx}`} position={[wx, 0.29, 0.58]}>
          {/* Outer Solid Industrial Tire with Deep Siped Tread */}
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
            <cylinderGeometry args={[0.29, 0.29, 0.22, 24]} />
            <meshStandardMaterial color="#090d16" roughness={0.92} />
          </mesh>
          {/* Inner Heavy Steel Wheel Hub */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.18, 0.18, 0.23, 16]} />
            <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Chrome Axle Hub Cap & 6 Heavy Lug Nuts */}
          <mesh position={[wx > 0 ? 0.12 : -0.12, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.08, 0.08, 0.03, 12]} />
            <meshStandardMaterial color="#0f172a" metalness={0.9} />
          </mesh>
          {[0, 1, 2, 3, 4, 5].map((nut) => {
            const angle = (nut * Math.PI) / 3;
            const ny = Math.sin(angle) * 0.12;
            const nz = Math.cos(angle) * 0.12;
            return (
              <mesh
                key={`nut-${nut}`}
                position={[wx > 0 ? 0.125 : -0.125, ny, nz]}
                rotation={[0, 0, Math.PI / 2]}
              >
                <cylinderGeometry args={[0.016, 0.016, 0.02, 6]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.1} />
              </mesh>
            );
          })}
        </group>
      ))}

      {/* REAR STEER WHEELS (Smaller Pivoting Solid Steer Tires) */}
      {[-0.52, 0.52].map((wx, idx) => (
        <group key={`rear-wheel-${idx}`} position={[wx, 0.23, -0.92]}>
          {/* Steer Tire */}
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
            <cylinderGeometry args={[0.23, 0.23, 0.18, 20]} />
            <meshStandardMaterial color="#090d16" roughness={0.92} />
          </mesh>
          {/* Steer Hub */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.14, 0.14, 0.19, 16]} />
            <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Chrome Center Cap */}
          <mesh position={[wx > 0 ? 0.1 : -0.1, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.06, 0.06, 0.025, 12]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
