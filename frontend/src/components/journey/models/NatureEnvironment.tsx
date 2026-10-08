import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createFoliageGeometry, createTreeTexture } from "./treeGeometry";

type Vector = [number, number, number];
type Instance = { position: Vector; scale: Vector; rotation: Vector; color: string };
type Kind = "trunk" | "leaves" | "pine" | "rock";

function smooth(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

// Continuous terrain remains below the entire facility and both vehicle approaches.
function landscapeHeight(x: number, z: number) {
  const sideClearance = smooth((Math.abs(x) - 38) / 34);
  const rearClearance = smooth((-z - 300) / 45);
  const approachClearance = smooth((Math.abs(x) - 9) / 20);
  const clearance = Math.max(sideClearance, rearClearance) * approachClearance;
  const hills = [
    [-125, -65, 30, 68, 100],
    [-145, -230, 43, 85, 110],
    [125, -100, 36, 70, 120],
    [160, -270, 48, 90, 95],
    [-70, -405, 50, 100, 70],
    [85, -430, 64, 105, 85],
  ];
  let height = 0;
  for (const [cx, cz, peak, width, depth] of hills) {
    height += peak * Math.exp(-(((x - cx) / width) ** 2 + ((z - cz) / depth) ** 2));
  }
  const detail = Math.sin(x * 0.055 + z * 0.026) * 2.1 + Math.cos(z * 0.071 - x * 0.023) * 1.2;
  return -0.12 + clearance * Math.max(0, height + detail);
}

function VegetationBatch({ items, kind }: { items: Instance[]; kind: Kind }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    if (kind === "trunk") return new THREE.CylinderGeometry(0.45, 1, 1, 10, 3);
    if (kind === "rock") return new THREE.IcosahedronGeometry(1, 1);
    return createFoliageGeometry(kind === "pine");
  }, [kind]);
  const texture = useMemo(() => (kind === "rock" ? null : createTreeTexture(kind)), [kind]);
  const foliage = kind === "leaves" || kind === "pine";
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture?.dispose(), [texture]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((item, index) => {
      transform.position.set(...item.position);
      transform.scale.set(...item.scale);
      transform.rotation.set(...item.rotation);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, color.set(item.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, items.length]} castShadow receiveShadow>
      <meshStandardMaterial
        map={texture}
        bumpMap={kind === "trunk" ? texture : null}
        bumpScale={0.075}
        alphaTest={foliage ? 0.38 : 0}
        side={foliage ? THREE.DoubleSide : THREE.FrontSide}
        roughness={kind === "rock" ? 0.95 : 0.88}
      />
      {foliage && (
        <meshDepthMaterial
          attach="customDepthMaterial"
          map={texture}
          alphaTest={0.38}
          side={THREE.DoubleSide}
          depthPacking={THREE.RGBADepthPacking}
        />
      )}
    </instancedMesh>
  );
}

function WindGrass() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { geometry, matrices, colors } = useMemo(() => {
    let seed = 9182;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    const matrices = new Float32Array(3200 * 16);
    const colors = new Float32Array(3200 * 3);
    const grassColors = ["#355b31", "#4f7738", "#698847", "#78964e"];

    for (let i = 0; i < 3200; i++) {
      let x: number;
      let z: number;
      if (i < 2200) {
        const side = i % 2 ? 1 : -1;
        // Keep the meadow visible around the apron, while leaving the vehicle
        // lanes clear. A second, wider band gives the horizon a natural falloff.
        const band = i % 5 === 0 ? 35 + random() * 32 : 18 + random() * 24;
        x = side * band;
        z = 24 - random() * 310;
      } else {
        // Scatter a second population over the actual hills. The terrain
        // height lookup below places every tuft on the slope rather than at
        // world Y=0, which makes the grass follow the contours naturally.
        x = (random() - 0.5) * 360;
        z = 35 - random() * 430;
        if (Math.abs(x) < 24 && z > -285) {
          x += x < 0 ? -28 : 28;
        }
      }
      const y = landscapeHeight(x, z) + 0.03;
      const height = 0.42 + random() * 1.35;
      transform.position.set(x, y, z);
      transform.rotation.set(0, random() * Math.PI, (random() - 0.5) * 0.18);
      transform.scale.set(0.7 + random() * 0.7, height, 0.7 + random() * 0.7);
      transform.updateMatrix();
      matrices.set(transform.matrix.elements, i * 16);
      color.set(grassColors[Math.floor(random() * grassColors.length)]);
      color.toArray(colors, i * 3);
    }

    // Two crossed, tapered cards read as a tuft from every camera angle.
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const indices: number[] = [];
    for (const angle of [0, Math.PI / 2]) {
      const base = positions.length / 3;
      const c = Math.cos(angle), s = Math.sin(angle);
      const add = (x: number, y: number, z: number) => {
        positions.push(x * c - z * s, y, x * s + z * c);
      };
      add(-0.18, 0, 0); add(0.18, 0, 0); add(0.1, 0.52, 0); add(-0.1, 0.52, 0);
      add(-0.13, 0.52, 0); add(0.13, 0.52, 0); add(0.035, 1, 0); add(-0.035, 1, 0);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      indices.push(base + 4, base + 5, base + 6, base + 4, base + 6, base + 7);
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return { geometry, matrices, colors };
  }, []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute("instanceColor", new THREE.InstancedBufferAttribute(colors, 3));
  }, [colors, matrices]);

  useFrame(({ clock }) => {
    if (materialRef.current) materialRef.current.uniforms.uTime.value = clock.elapsedTime;
  });

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, 3200]} castShadow receiveShadow>
      <shaderMaterial
        ref={materialRef}
        vertexColors
        side={THREE.DoubleSide}
        uniforms={{ uTime: { value: 0 } }}
        vertexShader={`
          attribute vec3 instanceColor;
          uniform float uTime;
          varying vec3 vColor;
          void main() {
            vColor = instanceColor;
            vec3 transformed = position;
            float field = uTime * 1.05 + instanceMatrix[3][0] * 0.08 + instanceMatrix[3][2] * 0.035;
            float gust = sin(field) * 0.12 + sin(field * 0.43 + 1.7) * 0.055;
            float ripple = sin(uTime * 2.1 + instanceMatrix[3][2] * 0.16) * 0.018;
            float bend = position.y * position.y;
            transformed.x += (gust + ripple) * bend;
            transformed.z += (gust * 0.42) * bend;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          void main() {
            gl_FragColor = vec4(vColor * (0.78 + 0.22 * vColor.g), 1.0);
          }
        `}
      />
    </instancedMesh>
  );
}

export function NatureEnvironment() {
  const terrain = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(600, 700, 160, 180);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -170);
    const vertices = geometry.attributes.position;
    const colors = new Float32Array(vertices.count * 3);
    const grass = new THREE.Color("#718451");
    const meadow = new THREE.Color("#9a9b66");
    const stone = new THREE.Color("#848879");
    const color = new THREE.Color();
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i),
        z = vertices.getZ(i);
      const y = landscapeHeight(x, z);
      vertices.setY(i, y);
      const patch = (Math.sin(x * 0.043 + z * 0.017) * Math.cos(z * 0.037) + 1) / 2;
      color
        .copy(grass)
        .lerp(meadow, patch * 0.6)
        .lerp(stone, smooth((y - 40) / 35) * 0.65);
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, []);
  useEffect(() => () => terrain.dispose(), [terrain]);

  const forest = useMemo(() => {
    let seed = 731;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const trunks: Instance[] = [],
      leaves: Instance[] = [],
      pines: Instance[] = [],
      rocks: Instance[] = [];
    const branchRotation = (start: THREE.Vector3, end: THREE.Vector3): Vector => {
      const direction = end.clone().sub(start).normalize();
      const rotation = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
      );
      return [rotation.x, rotation.y, rotation.z];
    };
    const foliage = ["#365940", "#496b43", "#5f7d49", "#718850", "#42634a"];
    for (let i = 0; i < 170; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (43 + random() * 115);
      const z = 42 - random() * 400;
      const y = landscapeHeight(x, z);
      const scale = 0.75 + random() * 0.95;
      const pine = i % 4 === 0;
      const height = (pine ? 7.2 : 5.5) * scale;
      const angle = random() * Math.PI * 2;
      trunks.push({
        position: [x, y + height * 0.4, z],
        scale: [0.24 * scale, height * 0.8, 0.28 * scale],
        rotation: [0, angle, 0.025 * (random() - 0.5)],
        color: "#9a8873",
      });
      if (pine) {
        for (let tier = 0; tier < 3; tier++) {
          const radius = (2.2 - tier * 0.48) * scale;
          pines.push({
            position: [x, y + height * (0.43 + tier * 0.21), z],
            scale: [radius, height * 0.56, radius],
            rotation: [0, angle + tier, 0],
            color: foliage[(i + tier) % 3],
          });
        }
      } else {
        for (let cluster = 0; cluster < 5; cluster++) {
          const theta = angle + cluster * 2.4;
          const spread = cluster === 0 ? 0 : 1.25 * scale;
          const branchStart = new THREE.Vector3(x, y + height * 0.4, z);
          const branchEnd = new THREE.Vector3(
            x + Math.cos(theta) * spread,
            y + height * 0.83,
            z + Math.sin(theta) * spread,
          );
          const branchMiddle = branchStart.clone().add(branchEnd).multiplyScalar(0.5);
          trunks.push({
            position: [branchMiddle.x, branchMiddle.y, branchMiddle.z],
            scale: [0.1 * scale, branchStart.distanceTo(branchEnd), 0.1 * scale],
            rotation: branchRotation(branchStart, branchEnd),
            color: "#8c7962",
          });
          leaves.push({
            position: [
              x + Math.cos(theta) * spread,
              y + height * (cluster === 0 ? 0.94 : 0.72) + random() * 0.5,
              z + Math.sin(theta) * spread,
            ],
            scale: [
              (1.5 + random() * 0.5) * scale,
              (1.65 + random() * 0.5) * scale,
              (1.4 + random() * 0.5) * scale,
            ],
            rotation: [random() * 0.3, theta, random() * 0.25],
            color: foliage[(i + cluster) % foliage.length],
          });
        }
      }
    }
    for (let i = 0; i < 52; i++) {
      const x = (i % 2 ? 1 : -1) * (40 + random() * 120),
        z = 35 - random() * 390;
      const size = 0.4 + random() * 1.6;
      rocks.push({
        position: [x, landscapeHeight(x, z) + size * 0.22, z],
        scale: [size * 1.3, size * 0.65, size],
        rotation: [random(), random() * Math.PI, random() * 0.4],
        color: i % 2 ? "#929383" : "#727c72",
      });
    }
    return { trunks, leaves, pines, rocks };
  }, []);

  return (
    <group>
      <mesh geometry={terrain} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.98} metalness={0} />
      </mesh>
      <WindGrass />
      <VegetationBatch items={forest.trunks} kind="trunk" />
      <VegetationBatch items={forest.leaves} kind="leaves" />
      <VegetationBatch items={forest.pines} kind="pine" />
      <VegetationBatch items={forest.rocks} kind="rock" />
    </group>
  );
}
