import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

function Block({ p, s, color = "#475569" }: { p: [number, number, number]; s: [number, number, number]; color?: string }) {
  return <mesh position={p} castShadow receiveShadow><boxGeometry args={s} /><meshStandardMaterial color={color} metalness={0.55} roughness={0.35} /></mesh>;
}
function Cylinder({ p, r, length, color = "#94a3b8", horizontal = false }: { p: [number, number, number]; r: number; length: number; color?: string; horizontal?: boolean }) {
  return <mesh position={p} rotation={horizontal ? [Math.PI / 2, 0, 0] : [0, 0, 0]} castShadow><cylinderGeometry args={[r, r, length, 32]} /><meshStandardMaterial color={color} metalness={0.7} roughness={0.28} /></mesh>;
}

function Operator({ position, rotation, quality = false }: { position: [number, number, number]; rotation: number; quality?: boolean }) {
  const head = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (head.current) head.current.rotation.y = Math.sin(t * 0.5) * 0.25;
    if (arm.current) arm.current.rotation.x = -0.7 + Math.sin(t * 1.5) * 0.12;
  });
  return <group position={position} rotation={[0, rotation, 0]}>
    {[-0.13, 0.13].map(x => <group key={x}><Block p={[x, 0.43, 0]} s={[0.19, 0.76, 0.21]} color="#24384e" /><Block p={[x, 0.08, 0.06]} s={[0.23, 0.15, 0.36]} color="#18202c" /></group>)}
    <Block p={[0, 1.08, 0]} s={[0.49, 0.62, 0.3]} color={quality ? "#eab308" : "#ea580c"} />
    {[0.94, 1.22].map(y => <Block key={y} p={[0, y, 0.158]} s={[0.49, 0.035, 0.012]} color="#e2e8f0" />)}
    <group ref={head} position={[0, 1.61, 0]}>
      <mesh castShadow><sphereGeometry args={[0.19, 20, 16]} /><meshStandardMaterial color="#b6805e" roughness={0.8} /></mesh>
      <mesh position={[0, 0.12, 0]} castShadow><sphereGeometry args={[0.21, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={quality ? "#f8fafc" : "#facc15"} /></mesh>
      <Cylinder p={[0, 0.12, 0.02]} r={0.24} length={0.035} color={quality ? "#f8fafc" : "#facc15"} />
      <Block p={[0, 0.025, 0.18]} s={[0.29, 0.07, 0.03]} color="#1e293b" />
    </group>
    {[-0.32, 0.32].map((x, i) => <group key={x} position={[x, 1.3, 0]} ref={i === 0 ? arm : undefined} rotation={[-0.8, 0, 0]}><Block p={[0, -0.24, 0]} s={[0.16, 0.47, 0.17]} color="#334155" /><mesh position={[0, -0.48, 0]}><sphereGeometry args={[0.09, 12, 12]} /><meshStandardMaterial color="#b6805e" /></mesh></group>)}
    <Block p={[0, 0.68, 0.65]} s={[0.12, 1.3, 0.12]} />
    <group position={[0, 1.28, 0.62]} rotation={[-0.35, 0, 0]}><Block p={[0, 0, 0]} s={[0.72, 0.42, 0.09]} color="#0f172a" /><Block p={[0, 0, -0.051]} s={[0.62, 0.32, 0.015]} color="#22d3ee" /></group>
  </group>;
}

/** Illustrative PUMP-100 manufacturing cycle; independent of real production records. */
export function PumpAssemblyCell({ position }: { position: [number, number, number] }) {
  const motor = useRef<THREE.Group>(null);
  const impeller = useRef<THREE.Group>(null);
  const spindle = useRef<THREE.Group>(null);
  const product = useRef<THREE.Group>(null);
  const scan = useRef<THREE.Mesh>(null);
  const label = useRef<HTMLDivElement>(null);
  const lastStage = useRef(-1);
  useFrame(({ clock }) => {
    const cycle = (clock.getElapsedTime() % 20) / 20;
    const stage = Math.min(4, Math.floor(cycle * 5));
    const ease = (start: number, end: number) => THREE.MathUtils.smoothstep(cycle, start, end);
    if (impeller.current) { impeller.current.position.z = -1.1 + ease(0.08, 0.32) * 1.1; impeller.current.rotation.z = cycle < 0.32 ? cycle * 12 : 0; }
    if (motor.current) motor.current.position.z = -1.8 + ease(0.32, 0.53) * 1.8;
    if (spindle.current) { spindle.current.position.y = -0.9 * Math.sin(ease(0.55, 0.77) * Math.PI); spindle.current.rotation.y = stage === 3 ? clock.getElapsedTime() * 18 : 0; }
    if (scan.current) { scan.current.visible = stage === 4; scan.current.position.z = Math.sin(clock.getElapsedTime() * 3) * 0.65; }
    if (product.current) product.current.position.x = ease(0.91, 0.99) * 2.1;
    if (stage !== lastStage.current && label.current) {
      label.current.textContent = ["01 · CASING / IMPELLER FEED", "02 · IMPELLER INSERTION", "03 · MOTOR FITTING", "04 · AUTOMATIC FASTENING", "05 · OPERATOR QUALITY CHECK"][stage] ?? "PUMP-100";
      lastStage.current = stage;
    }
  });
  return <group position={position}>
    <Block p={[0, 0.02, 0]} s={[7, 0.04, 5.5]} color="#273747" />
    {[-3.4, 3.4].map(x => <Block key={x} p={[x, 0.05, 0]} s={[0.06, 0.02, 5.4]} color="#facc15" />)}
    <Block p={[0, 0.65, 0]} s={[3.6, 1.2, 2.3]} color="#d4dce5" />
    <Block p={[0, 1.28, 0]} s={[3.8, 0.13, 2.5]} color="#374151" />
    {[-1.55, 1.55].map(x => <Block key={x} p={[x, 2.2, -0.8]} s={[0.16, 2.1, 0.18]} color="#eab308" />)}
    <Block p={[0, 3.25, -0.8]} s={[3.3, 0.28, 0.4]} color="#eab308" />
    <group ref={spindle} position={[0, 0, 0]}><Block p={[0, 2.96, -0.45]} s={[0.6, 0.46, 0.9]} color="#0284c7" /><Cylinder p={[0, 2.56, 0]} r={0.085} length={0.48} /><Cylinder p={[0, 2.29, 0]} r={0.04} length={0.18} color="#222b38" /></group>
    <group ref={product} position={[0, 0, 0]}>
      <Block p={[0, 1.42, 0]} s={[1.18, 0.14, 1.8]} color="#0369a1" />
      <Cylinder p={[0, 1.82, 0.35]} r={0.42} length={0.42} color="#0284c7" horizontal />
      <Cylinder p={[0, 1.82, 0.68]} r={0.17} length={0.35} horizontal />
      <Cylinder p={[0, 2.2, 0.35]} r={0.14} length={0.4} color="#0284c7" />
      <Cylinder p={[0, 2.4, 0.35]} r={0.23} length={0.08} />
      <group ref={impeller}><Cylinder p={[0, 1.82, 0.06]} r={0.32} length={0.09} color="#c7a450" horizontal />{Array.from({ length: 6 }, (_, i) => <group key={i} position={[0, 1.82, 0]} rotation={[0, 0, i * Math.PI / 3]}><Block p={[0.15, 0, 0]} s={[0.24, 0.045, 0.08]} color="#c7a450" /></group>)}</group>
      <group ref={motor}><Cylinder p={[0, 1.82, -0.6]} r={0.3} length={0.9} color="#0c6e99" horizontal />{Array.from({ length: 9 }, (_, i) => <Cylinder key={i} p={[0, 1.82, -0.97 + i * 0.09]} r={0.335} length={0.025} color="#3888a1" horizontal />)}<Block p={[0, 2.15, -0.6]} s={[0.32, 0.18, 0.3]} color="#164e63" /></group>
      {Array.from({ length: 8 }, (_, i) => <Cylinder key={i} p={[Math.sin(i * Math.PI / 4) * 0.35, 1.82 + Math.cos(i * Math.PI / 4) * 0.35, 0.57]} r={0.03} length={0.05} horizontal />)}
    </group>
    <mesh ref={scan} position={[0, 1.9, 0]}><planeGeometry args={[1.3, 1.2]} /><meshBasicMaterial color="#22d3ee" transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} /></mesh>
    <Operator position={[-2.55, 0.05, 1.3]} rotation={0.7} />
    <Operator position={[2.55, 0.05, 1.3]} rotation={-0.7} quality />
    <Html position={[0, 3.85, 0]} center distanceFactor={10} zIndexRange={[30, 0]}><div className="pointer-events-none w-72 rounded-lg border border-cyan-400/50 bg-slate-950/90 p-3 text-center font-mono"><div className="text-sm font-bold text-white">PUMP-100 · AUTOMATED ASSEMBLY</div><div ref={label} className="mt-2 text-[10px] text-cyan-300">CASING / IMPELLER FEED</div><div className="mt-1 text-[9px] text-slate-400">ILLUSTRATIVE CYCLE · OPERATOR SUPERVISED</div></div></Html>
  </group>;
}
