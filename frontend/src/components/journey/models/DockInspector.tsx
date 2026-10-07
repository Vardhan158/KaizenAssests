import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

interface DockInspectorProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  inspectionProgress?: number; // 0 to 1
}

export function DockInspector({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  inspectionProgress = 0,
}: DockInspectorProps) {
  const scannerArmRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    // Subtle human idling / scanning head motion
    if (headRef.current) {
      if (inspectionProgress > 0 && inspectionProgress < 1) {
        // Scanning back and forth across pallet cartons
        headRef.current.rotation.y = Math.sin(t * 3.5) * 0.22;
        headRef.current.rotation.x = 0.12 + Math.sin(t * 2.0) * 0.08;
      } else {
        headRef.current.rotation.y = Math.sin(t * 1.2) * 0.08;
        headRef.current.rotation.x = 0.05;
      }
    }

    // Handheld scanner aiming gesture
    if (scannerArmRef.current) {
      if (inspectionProgress > 0 && inspectionProgress < 1) {
        // Arm raised aiming scanner at pallet
        scannerArmRef.current.rotation.x = -0.75 + Math.sin(t * 4.0) * 0.12;
        scannerArmRef.current.rotation.z = -0.15;
      } else if (inspectionProgress >= 1) {
        // Inspection complete: Arm lowered with tablet checked
        scannerArmRef.current.rotation.x = -0.25;
        scannerArmRef.current.rotation.z = -0.05;
      } else {
        // Waiting idle
        scannerArmRef.current.rotation.x = -0.35 + Math.sin(t * 1.5) * 0.05;
      }
    }
  });

  const isScanning = inspectionProgress > 0.1 && inspectionProgress < 0.95;
  const isApproved = inspectionProgress >= 0.95;

  return (
    <group position={position} rotation={rotation}>
      {/* ─── LEGS & SAFETY BOOTS ─── */}
      {/* Left Leg */}
      <group position={[-0.14, 0.45, 0]}>
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[0.16, 0.9, 0.18]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} />
        </mesh>
        {/* Steel-Toe Boot */}
        <mesh position={[0, -0.42, 0.06]} castShadow>
          <boxGeometry args={[0.17, 0.14, 0.28]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
      </group>

      {/* Right Leg */}
      <group position={[0.14, 0.45, 0]}>
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[0.16, 0.9, 0.18]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} />
        </mesh>
        {/* Steel-Toe Boot */}
        <mesh position={[0, -0.42, 0.06]} castShadow>
          <boxGeometry args={[0.17, 0.14, 0.28]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
      </group>

      {/* ─── TORSO & HIGH-VISIBILITY SAFETY VEST ─── */}
      <group position={[0, 1.25, 0]}>
        {/* Base Torso / Navy Work Shirt */}
        <mesh castShadow>
          <boxGeometry args={[0.48, 0.72, 0.26]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} />
        </mesh>

        {/* High-Vis Fluorescent Lime Vest Overlay */}
        <mesh position={[0, 0.02, 0.01]} castShadow>
          <boxGeometry args={[0.5, 0.68, 0.27]} />
          <meshStandardMaterial color="#84cc16" roughness={0.5} />
        </mesh>

        {/* Silver Reflective Safety Stripes */}
        <mesh position={[0, 0.12, 0.14]}>
          <boxGeometry args={[0.505, 0.05, 0.02]} />
          <meshStandardMaterial color="#f8fafc" emissive="#cbd5e1" emissiveIntensity={1.5} />
        </mesh>
        <mesh position={[0, -0.12, 0.14]}>
          <boxGeometry args={[0.505, 0.05, 0.02]} />
          <meshStandardMaterial color="#f8fafc" emissive="#cbd5e1" emissiveIntensity={1.5} />
        </mesh>

        {/* Vertical Shoulder Straps */}
        {[-0.14, 0.14].map((sx, i) => (
          <mesh key={i} position={[sx, 0.18, 0.14]}>
            <boxGeometry args={[0.06, 0.32, 0.02]} />
            <meshStandardMaterial color="#f8fafc" emissive="#cbd5e1" emissiveIntensity={1.5} />
          </mesh>
        ))}

        {/* ID Badge on Chest */}
        <mesh position={[-0.15, 0.15, 0.15]}>
          <boxGeometry args={[0.08, 0.11, 0.01]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.8} />
        </mesh>
      </group>

      {/* ─── HEAD & SAFETY HARD HAT ─── */}
      <group position={[0, 1.76, 0]} ref={headRef}>
        {/* Face / Head */}
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[0.22, 0.24, 0.22]} />
          <meshStandardMaterial color="#fcd34d" roughness={0.5} />
        </mesh>

        {/* Protective Safety Goggles / Visor */}
        <mesh position={[0, 0.02, 0.115]}>
          <boxGeometry args={[0.23, 0.07, 0.04]} />
          <meshStandardMaterial
            color="#38bdf8"
            roughness={0.1}
            metalness={0.8}
            transparent
            opacity={0.7}
          />
        </mesh>

        {/* Safety Hard Hat (Safety Yellow) */}
        <group position={[0, 0.11, 0]}>
          {/* Hat Dome */}
          <mesh castShadow>
            <cylinderGeometry args={[0.16, 0.18, 0.14, 16]} />
            <meshStandardMaterial color="#eab308" metalness={0.2} roughness={0.3} />
          </mesh>
          {/* Hat Brim */}
          <mesh position={[0, -0.06, 0.03]} castShadow>
            <cylinderGeometry args={[0.22, 0.22, 0.02, 16]} />
            <meshStandardMaterial color="#ca8a04" metalness={0.2} roughness={0.3} />
          </mesh>
          {/* Top Apex Ridge */}
          <mesh position={[0, 0.08, 0]}>
            <boxGeometry args={[0.04, 0.04, 0.26]} />
            <meshStandardMaterial color="#ca8a04" />
          </mesh>
        </group>
      </group>

      {/* ─── LEFT ARM: DIGITAL TABLET / GOODS MANIFEST ─── */}
      <group position={[-0.32, 1.45, 0]}>
        {/* Upper Arm */}
        <mesh position={[0, -0.18, 0.08]} rotation={[0.4, 0, 0]} castShadow>
          <boxGeometry args={[0.12, 0.34, 0.12]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
        {/* Forearm angled forward holding tablet */}
        <group position={[0, -0.32, 0.18]} rotation={[-0.8, -0.3, 0]}>
          <mesh position={[0, -0.15, 0]} castShadow>
            <boxGeometry args={[0.11, 0.32, 0.11]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>

          {/* Digital Inventory Tablet */}
          <group position={[0, -0.28, 0.05]} rotation={[0.8, 0, 0]}>
            {/* Tablet Chassis */}
            <mesh castShadow>
              <boxGeometry args={[0.34, 0.24, 0.02]} />
              <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.2} />
            </mesh>
            {/* Illuminated Touchscreen Screen */}
            <mesh position={[0, 0, 0.012]}>
              <planeGeometry args={[0.31, 0.21]} />
              <meshStandardMaterial
                color="#0369a1"
                emissive="#0284c7"
                emissiveIntensity={2}
                roughness={0.1}
              />
            </mesh>
            {/* Screen Light Glow */}
            <pointLight color="#38bdf8" intensity={1.5} distance={1.8} />
          </group>
        </group>
      </group>

      {/* ─── RIGHT ARM: HANDHELD BARCODE SCANNER ─── */}
      <group position={[0.32, 1.45, 0]} ref={scannerArmRef}>
        {/* Upper Arm */}
        <mesh position={[0, -0.18, 0.08]} rotation={[0.4, 0, 0]} castShadow>
          <boxGeometry args={[0.12, 0.34, 0.12]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
        {/* Forearm holding scanner */}
        <group position={[0, -0.32, 0.18]}>
          <mesh position={[0, -0.15, 0]} castShadow>
            <boxGeometry args={[0.11, 0.32, 0.11]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>

          {/* Handheld Laser Barcode Gun */}
          <group position={[0, -0.3, 0.08]} rotation={[0.4, 0, 0]}>
            {/* Handle & Body */}
            <mesh castShadow>
              <boxGeometry args={[0.07, 0.14, 0.12]} />
              <meshStandardMaterial color="#334155" roughness={0.4} />
            </mesh>
            {/* Scanner Diode Tip */}
            <mesh position={[0, 0.04, 0.07]}>
              <boxGeometry args={[0.05, 0.05, 0.03]} />
              <meshStandardMaterial
                color={isScanning ? "#22d3ee" : isApproved ? "#22c55e" : "#ef4444"}
                emissive={isScanning ? "#22d3ee" : isApproved ? "#22c55e" : "#ef4444"}
                emissiveIntensity={4}
              />
            </mesh>

            {/* Active Barcode Laser Scan Beam Sweeping toward Pallet */}
            {isScanning && (
              <group position={[0, 0.04, 0.1]}>
                <mesh position={[0, 0, 0.8]} rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.008, 0.04, 1.6, 8]} />
                  <meshBasicMaterial color="#22d3ee" transparent opacity={0.65} />
                </mesh>
                <pointLight color="#22d3ee" intensity={2.5} distance={3.5} />
              </group>
            )}
          </group>
        </group>
      </group>

    </group>
  );
}
