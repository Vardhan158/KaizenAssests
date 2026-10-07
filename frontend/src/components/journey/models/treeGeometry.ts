import * as THREE from "three";

// Procedural foliage cards retain gaps between leaves, unlike solid canopy meshes.
export function createFoliageGeometry(pine: boolean) {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const transform = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const point = new THREE.Vector3();
  const count = pine ? 38 : 28;
  for (let i = 0; i < count; i++) {
    const theta = i * 2.399963;
    const height = (i + 0.5) / count;
    const radius = pine ? (1 - height) * 0.9 : Math.sqrt(1 - (height * 2 - 1) ** 2) * 0.75;
    const center = new THREE.Vector3(
      Math.cos(theta) * radius,
      pine ? height - 0.5 : height * 1.8 - 0.9,
      Math.sin(theta) * radius,
    );
    quaternion.setFromEuler(
      new THREE.Euler(pine ? -0.35 : Math.sin(theta) * 0.8, theta, Math.cos(theta) * 0.35),
    );
    const width = pine ? 0.8 * (1 - height) + 0.25 : 0.85;
    transform.compose(center, quaternion, new THREE.Vector3(width, pine ? 0.48 : 0.85, width));
    const base = positions.length / 3;
    // A folded card catches light from more than one direction.
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 3; col++) {
        point.set(col / 2 - 0.5, row - 0.5, col === 1 ? 0.14 : 0).applyMatrix4(transform);
        positions.push(point.x, point.y, point.z);
        uvs.push(col / 2, row);
      }
    indices.push(
      base,
      base + 1,
      base + 3,
      base + 1,
      base + 4,
      base + 3,
      base + 1,
      base + 2,
      base + 4,
      base + 2,
      base + 5,
      base + 4,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createTreeTexture(kind: "trunk" | "leaves" | "pine") {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let seed = 8921;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  if (kind === "trunk") {
    ctx.fillStyle = "#b6a28b";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 240; i++) {
      const x = random() * 256,
        y = random() * 256;
      ctx.strokeStyle = i % 3 ? "rgba(54,40,27,0.45)" : "rgba(237,216,178,0.4)";
      ctx.lineWidth = 0.5 + random() * 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - 3, y + 12, x + 4, y + 26, x - 1, y + 45);
      ctx.stroke();
    }
  } else {
    ctx.clearRect(0, 0, 256, 256);
    ctx.lineCap = "round";
    // Central twig with paired lateral sprays. Alpha background leaves real gaps.
    ctx.strokeStyle = "#9d9b75";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(128, 246);
    ctx.quadraticCurveTo(110, 128, 134, 18);
    ctx.stroke();
    for (let branch = 0; branch < 10; branch++) {
      const side = branch % 2 ? 1 : -1;
      const y = 215 - Math.floor(branch / 2) * 38;
      const tipX = 128 + side * (70 + random() * 28),
        tipY = y - 45;
      ctx.strokeStyle = "#a4a67c";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(126, y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      const leafCount = kind === "pine" ? 18 : 7;
      for (let leaf = 0; leaf < leafCount; leaf++) {
        const t = (leaf + 1) / (leafCount + 1);
        const x = 126 + (tipX - 126) * t,
          ly = y + (tipY - y) * t;
        const flip = leaf % 2 ? 1 : -1;
        ctx.save();
        ctx.translate(x, ly);
        ctx.rotate(side * 0.8 + flip * 0.75);
        const shade = 165 + Math.floor(random() * 80);
        ctx.fillStyle =
          "rgb(" + Math.floor(shade * 0.91) + "," + shade + "," + Math.floor(shade * 0.75) + ")";
        ctx.beginPath();
        if (kind === "pine") ctx.ellipse(0, -12, 1.8, 16, 0, 0, Math.PI * 2);
        else {
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(-13, -9, -12, -24, 0, -32);
          ctx.bezierCurveTo(12, -24, 13, -9, 0, 0);
        }
        ctx.fill();
        if (kind === "leaves") {
          ctx.strokeStyle = "rgba(236,242,195,0.45)";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, -28);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  if (kind === "trunk") {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 3);
  }
  return texture;
}
