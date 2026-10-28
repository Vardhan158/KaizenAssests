import { Html, Text } from "@react-three/drei";
import { supplierJourney } from "../supplierJourney";
import type { GroupProps } from "@react-three/fiber";

interface SupplierAsnEnvelopeProps extends GroupProps {
  progress: number;
  asn?: any;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value: number) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

/** A procedural envelope used only for the read-only landing-page story. */
export function SupplierAsnEnvelope({ progress, asn, ...groupProps }: SupplierAsnEnvelopeProps) {
  const delivery = supplierJourney(progress);
  const travel = smoothstep((progress - 0.12) / 0.53);
  const open = delivery.open;
  // Follow the existing inbound camera corridor. The camera moves from the
  // front approach (z ~= 43) to the receiving checkpoint (z ~= -17) during
  // this same local ASN interval, so keeping the envelope on that corridor
  // prevents it from disappearing behind or beyond the active camera.
  const x = delivery.envelope.x;
  const z = delivery.envelope.z;
  const y = delivery.envelope.y;
  const flapAngle = -open * Math.PI * 0.82;
  const documentY = 0.12 + open * 1.8;
  const documentScale = 0.72 + open * 0.28;
  const text = (value: unknown) =>
    value === null || value === undefined || value === "" ? "—" : String(value);

  return (
    <group
      {...groupProps}
      position={[x, y, z]}
      rotation={[0, travel * 0.3, Math.sin(travel * Math.PI) * 0.04]}
      frustumCulled={false}
      renderOrder={100}
    >
      <group scale={0.45 * (1 - smoothstep((progress - 0.97) / 0.03))}>
        {/* Upright envelope body, facing the camera like a piece of mail. */}
        <mesh castShadow receiveShadow renderOrder={100}>
          <boxGeometry args={[3.2, 2.15, 0.12]} />
          <meshStandardMaterial
            color="#f8fafc"
            emissive="#164e63"
            emissiveIntensity={0.16}
            roughness={0.48}
            metalness={0.06}
            depthTest={false}
          />
        </mesh>
        <mesh position={[0, 0, 0.071]} renderOrder={101}>
          <planeGeometry args={[3.08, 2.05]} />
          <meshStandardMaterial color="#dbeafe" roughness={0.6} side={2} depthTest={false} />
        </mesh>
        {/* Fold lines make the white card read immediately as a mail envelope. */}
        <mesh position={[-0.72, 0.42, 0.085]} rotation={[0, 0, 0.62]} renderOrder={103}>
          <boxGeometry args={[1.82, 0.055, 0.025]} />
          <meshStandardMaterial
            color="#60a5fa"
            emissive="#2563eb"
            emissiveIntensity={0.2}
            depthTest={false}
          />
        </mesh>
        <mesh position={[0.72, 0.42, 0.085]} rotation={[0, 0, -0.62]} renderOrder={103}>
          <boxGeometry args={[1.82, 0.055, 0.025]} />
          <meshStandardMaterial
            color="#60a5fa"
            emissive="#2563eb"
            emissiveIntensity={0.2}
            depthTest={false}
          />
        </mesh>
        {/* Real 3D lettering is fixed to the face, so ASN cannot drift away. */}
        <Text
          position={[0, -0.3, 0.13]}
          fontSize={0.78}
          color="#020617"
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.08}
          outlineWidth={0.025}
          outlineColor="#ffffff"
          renderOrder={104}
          material-depthTest={false}
        >
          ASN
        </Text>
        {/* Flap stays closed during travel and opens only at security. */}
        <group position={[0, 1.04, 0.08]} rotation={[flapAngle, 0, 0]}>
          <mesh position={[0, -0.52, 0]} renderOrder={102}>
            <planeGeometry args={[3.05, 1.05]} />
            <meshStandardMaterial color="#bfdbfe" roughness={0.55} side={2} depthTest={false} />
          </mesh>
        </group>
        <mesh position={[0, 0.05, 0.1]} renderOrder={103}>
          <boxGeometry args={[0.28, 0.28, 0.035]} />
          <meshStandardMaterial
            color="#06b6d4"
            emissive="#22d3ee"
            emissiveIntensity={0.8}
            depthTest={false}
          />
        </mesh>
        {/* The detail card is intentionally disabled to prevent gate overlap. */}
        {open > 1 && (
          <group position={[0, documentY, 0.13]} scale={documentScale}>
            <mesh visible={open > 0.01} castShadow renderOrder={104}>
              <boxGeometry args={[2.35, 1.55, 0.035]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive="#cffafe"
                emissiveIntensity={0.25}
                roughness={0.7}
                depthTest={false}
              />
            </mesh>
            {open > 0.08 && (
              <Html position={[0, 0, 0.04]} transform distanceFactor={8} zIndexRange={[20, 0]}>
                <div className="w-52 rounded-md border border-cyan-400/50 bg-slate-950/95 p-2 text-left font-mono text-[8px] text-white shadow-xl">
                  <div className="mb-1 border-b border-cyan-400/30 pb-1 text-[9px] font-black tracking-widest text-cyan-300">
                    ASN DOCUMENT
                  </div>
                  <div>ASN: {text(asn?.asn_number)}</div>
                  <div>SUPPLIER: {text(asn?.supplier_name)}</div>
                  <div>PO: {text(asn?.po_number)}</div>
                  <div>
                    EXPECTED: {text(asn?.expected_arrival_at || asn?.expected_arrival_date)}
                  </div>
                  <div>VEHICLE: {text(asn?.vehicle_number)}</div>
                  <div>STATUS: {text(asn?.status)}</div>
                </div>
              </Html>
            )}
          </group>
        )}
      </group>
    </group>
  );
}
