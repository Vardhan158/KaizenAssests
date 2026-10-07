import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

interface AssemblyStationProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  assemblyProgress?: number; // 0 to 1
}

export function AssemblyStation({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  assemblyProgress: _assemblyProgress = 0,
}: AssemblyStationProps) {
  // ─── MACHINE 1 (Left: Component Feeder & Pre-Assembly Robot) ───
  const m1BaseRef = useRef<THREE.Group>(null);
  const m1ShoulderRef = useRef<THREE.Group>(null);
  const m1ElbowRef = useRef<THREE.Group>(null);
  const m1WristRef = useRef<THREE.Group>(null);
  const m1LaserRef = useRef<THREE.PointLight>(null);

  // ─── MACHINE 2 (Right: Packing & Box-Loading Robot) ───
  const m2BaseRef = useRef<THREE.Group>(null);
  const m2ShoulderRef = useRef<THREE.Group>(null);
  const m2ElbowRef = useRef<THREE.Group>(null);
  const m2WristRef = useRef<THREE.Group>(null);
  const heldProductRef = useRef<THREE.Group>(null);
  const boxProductRef = useRef<THREE.Group>(null);

  // ─── STATUS LIGHTS & TELEMETRY ───
  const statusLightRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();
    // Continuous smooth operational cycle (approx 4.5 seconds per complete pick-and-pack loop)
    const cycle = (time * 0.28) % 1; // 0 to 1

    // ─────────────────────────────────────────────────────────────
    // 1. MACHINE 1 KINEMATICS (Feeder -> Central Fixture)
    // ─────────────────────────────────────────────────────────────
    // Picks electronic component from infeed bin (-45 deg) and places on central assembly jig (0 deg)
    const m1Phase = (cycle * 2) % 1; // runs at 2x cadence
    let m1RotY = 0;
    let m1ShoulderPitch = 0;
    let m1ElbowPitch = 0;

    if (m1Phase < 0.35) {
      // Descend into parts infeed bin (left)
      const t = m1Phase / 0.35;
      m1RotY = -0.75;
      m1ShoulderPitch = -0.25 + Math.sin(t * Math.PI) * 0.45;
      m1ElbowPitch = 0.5 - Math.sin(t * Math.PI) * 0.4;
    } else if (m1Phase < 0.7) {
      // Swivel arm from bin to central fixture
      const t = (m1Phase - 0.35) / 0.35;
      m1RotY = -0.75 + t * 0.85;
      m1ShoulderPitch = -0.15;
      m1ElbowPitch = 0.4;
    } else {
      // Lower down onto central assembly jig and place component
      const t = (m1Phase - 0.7) / 0.3;
      m1RotY = 0.1;
      m1ShoulderPitch = -0.15 + Math.sin(t * Math.PI) * 0.4;
      m1ElbowPitch = 0.4 - Math.sin(t * Math.PI) * 0.35;
    }

    if (m1BaseRef.current) m1BaseRef.current.rotation.y = m1RotY;
    if (m1ShoulderRef.current) m1ShoulderRef.current.rotation.z = m1ShoulderPitch;
    if (m1ElbowRef.current) m1ElbowRef.current.rotation.z = m1ElbowPitch;
    if (m1WristRef.current) m1WristRef.current.rotation.x = Math.sin(time * 6) * 0.15;
    if (m1LaserRef.current) m1LaserRef.current.intensity = 1.0 + Math.sin(time * 10) * 0.8;

    // ─────────────────────────────────────────────────────────────
    // 2. MACHINE 2 KINEMATICS (Central Fixture -> Goods Box)
    // ─────────────────────────────────────────────────────────────
    // Reaches to central fixture, grabs finished assembled module,
    // lifts it, swivels over to the goods box, and deposits it into the box!
    let m2RotY = 0;
    let m2ShoulderPitch = 0;
    let m2ElbowPitch = 0;
    let isHoldingProduct = false;
    let boxItemVisible = false;

    if (cycle < 0.22) {
      // Phase A: Descending to central fixture to pick up finished product
      const t = cycle / 0.22;
      m2RotY = -0.65; // facing central jig
      m2ShoulderPitch = -0.2 + Math.sin(t * Math.PI) * 0.5;
      m2ElbowPitch = 0.65 - Math.sin(t * Math.PI) * 0.45;
      isHoldingProduct = t > 0.6; // clamps onto item at bottom of dip
    } else if (cycle < 0.48) {
      // Phase B: Lifting product up & swiveling 90 degrees over to the Goods Box
      const t = (cycle - 0.22) / 0.26;
      m2RotY = -0.65 + t * 1.55; // rotates to +0.9 (facing goods box)
      m2ShoulderPitch = -0.25 + Math.sin(t * Math.PI) * 0.2; // elevated clearance
      m2ElbowPitch = 0.6;
      isHoldingProduct = true;
    } else if (cycle < 0.78) {
      // Phase C: Lowering down DIRECTLY INSIDE THE GOODS BOX and placing item!
      const t = (cycle - 0.48) / 0.3;
      m2RotY = 0.9; // positioned squarely over box
      // Dips arm deep into the box
      const dip = Math.sin(t * Math.PI);
      m2ShoulderPitch = -0.25 + dip * 0.58;
      m2ElbowPitch = 0.6 - dip * 0.52;
      // Item is held until bottom of dip, then released into the box
      isHoldingProduct = t < 0.7;
      boxItemVisible = t >= 0.7;
    } else {
      // Phase D: Retracting upward out of the box and returning to central fixture
      const t = (cycle - 0.78) / 0.22;
      m2RotY = 0.9 - t * 1.55;
      m2ShoulderPitch = -0.25;
      m2ElbowPitch = 0.65;
      isHoldingProduct = false;
      boxItemVisible = true;
    }

    if (m2BaseRef.current) m2BaseRef.current.rotation.y = m2RotY;
    if (m2ShoulderRef.current) m2ShoulderRef.current.rotation.z = m2ShoulderPitch;
    if (m2ElbowRef.current) m2ElbowRef.current.rotation.z = m2ElbowPitch;
    if (m2WristRef.current) m2WristRef.current.rotation.y = cycle * Math.PI * 2;

    if (heldProductRef.current) heldProductRef.current.visible = isHoldingProduct;
    if (boxProductRef.current) boxProductRef.current.visible = boxItemVisible;

    if (statusLightRef.current) {
      statusLightRef.current.intensity = 2.0 + Math.sin(time * 4) * 0.8;
    }
  });

  return (
    <group position={position} rotation={rotation}>
      {/* ══════════════════════════════════════════════════════════════════
          1. HEAVY INDUSTRIAL WORKSTATION TABLE & FRAMING
          ══════════════════════════════════════════════════════════════════ */}
      {/* Workstation Tabletop (Heavy slate composite with anodized rails) */}
      <mesh position={[-0.2, 0.92, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 0.12, 2.2]} />
        <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* T-Slot Aluminum Framing Trim */}
      <mesh position={[-0.2, 0.985, 0]}>
        <boxGeometry args={[3.16, 0.015, 2.16]} />
        <meshStandardMaterial color="#334155" metalness={0.85} roughness={0.2} />
      </mesh>

      {/* Heavy Steel Support Legs & Cross Braces */}
      {[-1.6, 1.2].map((lx, i) =>
        [-0.9, 0.9].map((lz, j) => (
          <group key={`leg-${i}-${j}`} position={[lx, 0.45, lz]}>
            <mesh castShadow>
              <boxGeometry args={[0.12, 0.9, 0.12]} />
              <meshStandardMaterial color="#0f172a" metalness={0.85} />
            </mesh>
            {/* Leveling Foot Pad */}
            <mesh position={[0, -0.42, 0]}>
              <cylinderGeometry args={[0.09, 0.09, 0.05, 12]} />
              <meshStandardMaterial color="#475569" metalness={0.9} />
            </mesh>
          </group>
        ))
      )}

      {/* Safety Floor Perimeter Striping (Yellow/Black Industrial Hazard Border) */}
      {[-1.4, -0.6, 0.2, 1.0].map((px, i) => (
        <mesh key={`floor-mark-${i}`} position={[px, 0.01, 1.2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.3, 0.12]} />
          <meshStandardMaterial color="#facc15" />
        </mesh>
      ))}

      {/* ─── DIGITAL PRODUCTION HMI TERMINAL SCREEN ─── */}
      <group position={[-1.3, 1.5, -0.8]} rotation={[0, 0.4, 0]}>
        {/* Terminal Stand Arm */}
        <mesh position={[0, -0.3, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.6, 12]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} />
        </mesh>
        {/* Enclosure Casing */}
        <mesh castShadow>
          <boxGeometry args={[0.74, 0.48, 0.06]} />
          <meshStandardMaterial color="#090d16" roughness={0.4} />
        </mesh>
        {/* Glowing Touchscreen UI (Live Telemetry & Packaging Counter) */}
        <mesh position={[0, 0, 0.032]}>
          <planeGeometry args={[0.68, 0.42]} />
          <meshStandardMaterial
            color="#0369a1"
            emissive="#0284c7"
            emissiveIntensity={2.2}
            roughness={0.15}
          />
        </mesh>
        {/* Top 3-Color Industrial Andon Beacon Tower (Red / Amber / Green) */}
        <group position={[0.3, 0.32, 0]}>
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.14, 12]} />
            <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={3} />
          </mesh>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.1, 12]} />
            <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.8} />
          </mesh>
        </group>
      </group>

      {/* Overhead LED Task Light Bar */}
      <group position={[-0.2, 2.5, 0]}>
        <mesh castShadow>
          <boxGeometry args={[2.6, 0.08, 0.18]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} />
        </mesh>
        <mesh position={[0, -0.04, 0]}>
          <planeGeometry args={[2.5, 0.14]} />
          <meshStandardMaterial color="#ffffff" emissive="#f8fafc" emissiveIntensity={3.5} />
        </mesh>
        <pointLight ref={statusLightRef} position={[0, -0.2, 0]} color="#bae6fd" intensity={3.0} distance={8} />
      </group>

      {/* ══════════════════════════════════════════════════════════════════
          2. PARTS FEEDER INTAKE (Left Side) & CENTRAL ASSEMBLY JIG
          ══════════════════════════════════════════════════════════════════ */}
      {/* Vibratory Parts Bowl / Feeder Tray on Left */}
      <group position={[-1.25, 1.05, 0.25]}>
        {/* Hopper Casing */}
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.34, 0.28, 0.22, 24]} />
          <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Raw Component Stock in Feeder (Gold & Silver micro-modules) */}
        {[-0.1, 0, 0.1].map((rx, idx) => (
          <mesh key={`raw-${idx}`} position={[rx, 0.12, (idx - 1) * 0.08]} castShadow>
            <boxGeometry args={[0.09, 0.06, 0.09]} />
            <meshStandardMaterial color="#f59e0b" metalness={0.9} roughness={0.2} />
          </mesh>
        ))}
      </group>

      {/* Central High-Precision Assembly Jig / Nest */}
      <group position={[-0.2, 1.02, 0.1]}>
        {/* Pneumatic Clamping Fixture Base */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.55, 0.08, 0.55]} />
          <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.25} />
        </mesh>
        {/* 4 Guide Locator Pins */}
        {[-0.22, 0.22].map((px, i) =>
          [-0.22, 0.22].map((pz, j) => (
            <mesh key={`pin-${i}-${j}`} position={[px, 0.06, pz]}>
              <cylinderGeometry args={[0.015, 0.015, 0.08, 8]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.95} />
            </mesh>
          ))
        )}
        {/* Assembled Product Module on Fixture Base */}
        <group position={[0, 0.08, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.32, 0.08, 0.32]} />
            <meshStandardMaterial color="#0284c7" metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Internal Electronics PCB & Heat Sink Fins */}
          <mesh position={[0, 0.05, 0]}>
            <boxGeometry args={[0.26, 0.03, 0.26]} />
            <meshStandardMaterial color="#10b981" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.08, 0]}>
            <boxGeometry args={[0.18, 0.04, 0.18]} />
            <meshStandardMaterial color="#f59e0b" metalness={0.9} />
          </mesh>
        </group>
      </group>

      {/* ══════════════════════════════════════════════════════════════════
          3. MACHINE 1: COMPONENT FEEDER & PRE-ASSEMBLY ROBOT (Left)
          ══════════════════════════════════════════════════════════════════ */}
      <group position={[-0.8, 0.98, -0.35]}>
        {/* Heavy Cast Turret Pedestal Base */}
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.26, 0.3, 0.16, 20]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} />
        </mesh>

        {/* Machine 1 Rotating Turret Body (KUKA Safety Orange) */}
        <group position={[0, 0.12, 0]} ref={m1BaseRef}>
          <mesh castShadow>
            <cylinderGeometry args={[0.22, 0.24, 0.22, 16]} />
            <meshStandardMaterial color="#ea580c" metalness={0.4} roughness={0.35} />
          </mesh>

          {/* Shoulder Articulation Joint */}
          <group position={[0, 0.16, 0]} ref={m1ShoulderRef}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.12, 0.12, 0.28, 16]} />
              <meshStandardMaterial color="#1e293b" metalness={0.8} />
            </mesh>
            {/* Primary Lower Arm Casting */}
            <mesh position={[0, 0.52, 0]} castShadow>
              <boxGeometry args={[0.16, 0.95, 0.18]} />
              <meshStandardMaterial color="#ea580c" metalness={0.4} roughness={0.35} />
            </mesh>

            {/* Elbow Articulation Joint */}
            <group position={[0, 1.0, 0]} ref={m1ElbowRef}>
              <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.1, 0.1, 0.24, 16]} />
                <meshStandardMaterial color="#1e293b" metalness={0.8} />
              </mesh>
              {/* Forearm Extension Segment */}
              <mesh position={[0, 0.46, 0]} castShadow>
                <boxGeometry args={[0.12, 0.85, 0.14]} />
                <meshStandardMaterial color="#ea580c" metalness={0.4} roughness={0.35} />
              </mesh>

              {/* Wrist Tool & Parallel Pneumatic Gripper */}
              <group position={[0, 0.9, 0]} ref={m1WristRef}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.08, 0.08, 0.12, 16]} />
                  <meshStandardMaterial color="#0284c7" metalness={0.8} />
                </mesh>
                {/* Twin Pneumatic Gripper Fingers */}
                {[-0.05, 0.05].map((fx, i) => (
                  <mesh key={`finger-1-${i}`} position={[fx, 0.1, 0]} castShadow>
                    <boxGeometry args={[0.02, 0.16, 0.04]} />
                    <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.1} />
                  </mesh>
                ))}
                {/* Precision Assembly Alignment Laser Light */}
                <pointLight ref={m1LaserRef} position={[0, 0.18, 0]} color="#22d3ee" intensity={2.0} distance={2.5} />
              </group>
            </group>
          </group>
        </group>
      </group>

      {/* ══════════════════════════════════════════════════════════════════
          4. MACHINE 2: PACKING & BOX-LOADING ROBOT (Right)
          ══════════════════════════════════════════════════════════════════ */}
      <group position={[0.45, 0.98, -0.35]}>
        {/* Heavy Cast Turret Pedestal Base */}
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.28, 0.32, 0.16, 20]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} />
        </mesh>

        {/* Machine 2 Rotating Turret Body (Fanuc Industrial Yellow/Amber) */}
        <group position={[0, 0.12, 0]} ref={m2BaseRef}>
          <mesh castShadow>
            <cylinderGeometry args={[0.24, 0.26, 0.24, 16]} />
            <meshStandardMaterial color="#f59e0b" metalness={0.4} roughness={0.35} />
          </mesh>

          {/* Shoulder Articulation Joint */}
          <group position={[0, 0.18, 0]} ref={m2ShoulderRef}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.13, 0.13, 0.3, 16]} />
              <meshStandardMaterial color="#1e293b" metalness={0.8} />
            </mesh>
            {/* Primary Lower Arm Casting */}
            <mesh position={[0, 0.58, 0]} castShadow>
              <boxGeometry args={[0.18, 1.05, 0.2]} />
              <meshStandardMaterial color="#f59e0b" metalness={0.4} roughness={0.35} />
            </mesh>

            {/* Elbow Articulation Joint */}
            <group position={[0, 1.1, 0]} ref={m2ElbowRef}>
              <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.11, 0.11, 0.26, 16]} />
                <meshStandardMaterial color="#1e293b" metalness={0.8} />
              </mesh>
              {/* Forearm Segment */}
              <mesh position={[0, 0.5, 0]} castShadow>
                <boxGeometry args={[0.14, 0.95, 0.16]} />
                <meshStandardMaterial color="#f59e0b" metalness={0.4} roughness={0.35} />
              </mesh>

              {/* Wrist & Vacuum Packaging Gripper Tool */}
              <group position={[0, 1.0, 0]} ref={m2WristRef}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.09, 0.09, 0.14, 16]} />
                  <meshStandardMaterial color="#0f172a" metalness={0.85} />
                </mesh>
                {/* Vacuum Cup Crosshead */}
                <mesh position={[0, 0.08, 0]} castShadow>
                  <boxGeometry args={[0.26, 0.04, 0.26]} />
                  <meshStandardMaterial color="#334155" metalness={0.9} />
                </mesh>
                {/* 4 Vacuum Suction Cups */}
                {[-0.08, 0.08].map((vx, i) =>
                  [-0.08, 0.08].map((vz, j) => (
                    <mesh key={`cup-${i}-${j}`} position={[vx, 0.14, vz]}>
                      <cylinderGeometry args={[0.032, 0.018, 0.08, 12]} />
                      <meshStandardMaterial color="#0284c7" roughness={0.4} />
                    </mesh>
                  ))
                )}

                {/* ─── DYNAMIC ASSEMBLED PRODUCT HELD IN MACHINE 2 GRIPPER ─── */}
                <group position={[0, 0.22, 0]} ref={heldProductRef}>
                  <mesh castShadow>
                    <boxGeometry args={[0.28, 0.07, 0.28]} />
                    <meshStandardMaterial color="#0284c7" metalness={0.7} roughness={0.3} />
                  </mesh>
                  {/* Internal Core & Gold Contact Terminals */}
                  <mesh position={[0, 0.04, 0]}>
                    <boxGeometry args={[0.22, 0.03, 0.22]} />
                    <meshStandardMaterial color="#10b981" />
                  </mesh>
                  <mesh position={[0, 0.065, 0]}>
                    <boxGeometry args={[0.15, 0.03, 0.15]} />
                    <meshStandardMaterial color="#f59e0b" metalness={0.95} />
                  </mesh>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>

      {/* ══════════════════════════════════════════════════════════════════
          5. THE GOODS BOX (Corrugated Shipping Carton On Packing Conveyor)
          ══════════════════════════════════════════════════════════════════ */}
      {/* The Target Goods Box Positioned for Machine 2 to Load Products Inside */}
      <group position={[1.15, 0.98, 0.28]}>
        {/* Main Corrugated Cardboard Box Outer Body */}
        <mesh position={[0, 0.24, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.74, 0.48, 0.62]} />
          <meshStandardMaterial color="#c27803" roughness={0.88} />
        </mesh>
        {/* Inner Dark Hollow Cavity of the Box */}
        <mesh position={[0, 0.26, 0]}>
          <boxGeometry args={[0.68, 0.46, 0.56]} />
          <meshStandardMaterial color="#78350f" roughness={0.95} />
        </mesh>

        {/* 4 Realistic Folded Cardboard Top Flaps (Open for Loading) */}
        {/* Front Flap (Angled Forward) */}
        <mesh position={[0, 0.49, 0.32]} rotation={[0.42, 0, 0]} castShadow>
          <boxGeometry args={[0.74, 0.02, 0.18]} />
          <meshStandardMaterial color="#d97706" roughness={0.85} />
        </mesh>
        {/* Back Flap (Angled Backward) */}
        <mesh position={[0, 0.49, -0.32]} rotation={[-0.42, 0, 0]} castShadow>
          <boxGeometry args={[0.74, 0.02, 0.18]} />
          <meshStandardMaterial color="#d97706" roughness={0.85} />
        </mesh>
        {/* Left Flap (Angled Left toward Table) */}
        <mesh position={[-0.38, 0.49, 0]} rotation={[0, 0, 0.42]} castShadow>
          <boxGeometry args={[0.18, 0.02, 0.62]} />
          <meshStandardMaterial color="#d97706" roughness={0.85} />
        </mesh>
        {/* Right Flap (Angled Right) */}
        <mesh position={[0.38, 0.49, 0]} rotation={[0, 0, -0.42]} castShadow>
          <boxGeometry args={[0.18, 0.02, 0.62]} />
          <meshStandardMaterial color="#d97706" roughness={0.85} />
        </mesh>

        {/* Outer Printed Logistics Shipping Label with 2D Barcode */}
        <mesh position={[-0.372, 0.24, 0.02]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[0.36, 0.22]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} />
        </mesh>
        {/* Printed Barcode Lines on Label */}
        <mesh position={[-0.374, 0.24, 0.02]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[0.28, 0.08]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>

        {/* ─── GOODS INSIDE THE BOX ─── */}
        {/* Previously Loaded Item 1 (Resting in Bottom of Box) */}
        <group position={[-0.14, 0.14, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.26, 0.07, 0.26]} />
            <meshStandardMaterial color="#0284c7" metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.04, 0]}>
            <boxGeometry args={[0.2, 0.03, 0.2]} />
            <meshStandardMaterial color="#10b981" />
          </mesh>
        </group>

        {/* Dynamic Item 2: Deposited directly into the box by Machine 2! */}
        <group position={[0.14, 0.14, 0]} ref={boxProductRef}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.26, 0.07, 0.26]} />
            <meshStandardMaterial color="#0284c7" metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.04, 0]}>
            <boxGeometry args={[0.2, 0.03, 0.2]} />
            <meshStandardMaterial color="#10b981" />
          </mesh>
        </group>
      </group>

      {/* ─── SECOND COMPLETED & SEALED GOODS BOX (Downstream on Line) ─── */}
      <group position={[1.15, 0.98, -1.0]}>
        {/* Sealed Shipping Carton */}
        <mesh position={[0, 0.24, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.74, 0.48, 0.62]} />
          <meshStandardMaterial color="#c27803" roughness={0.88} />
        </mesh>
        {/* Clear Packing Tape Across Top Seam */}
        <mesh position={[0, 0.485, 0]}>
          <boxGeometry args={[0.1, 0.01, 0.64]} />
          <meshStandardMaterial color="#fef08a" transparent opacity={0.65} roughness={0.2} />
        </mesh>
        {/* White Barcode Shipping Label */}
        <mesh position={[-0.372, 0.24, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[0.34, 0.2]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}
