import type { MeshData, SubMesh } from '../loader/OBJLoader';

// UV sphere with outward-facing CCW normals; interleaved pos(3)+norm(3)+uv(2)
export function generateSphere(rings: number, segs: number): MeshData {
  const verts: number[] = [];
  const idxs: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    const sinP = Math.sin(phi), cosP = Math.cos(phi);
    for (let s = 0; s <= segs; s++) {
      const theta = (s / segs) * 2 * Math.PI;
      const x = sinP * Math.cos(theta);
      const y = cosP;
      const z = sinP * Math.sin(theta);
      verts.push(x, y, z,  x, y, z,  s / segs, r / rings);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s;
      const b = a + segs + 1;
      idxs.push(a, a + 1, b + 1,  a, b + 1, b);
    }
  }
  return {
    vertices: new Float32Array(verts),
    indices:  new Uint32Array(idxs),
    submeshes: [{ name: 'sphere', start: 0, count: idxs.length }],
  };
}

// Macbeth ColorChecker Classic — 6 cols × 4 rows
// sRGB values (0-1) as displayed on a calibrated monitor
export const MACBETH_SRGB: readonly [number, number, number][] = (
  [
    [115, 82,  68 ], [194, 150, 130], [98,  122, 157], [87,  108,  67], [133, 128, 177], [103, 189, 170],
    [214, 126,  44], [80,   91, 166], [193,  90,  99], [94,   60, 108], [157, 188,  64], [224, 163,  46],
    [56,   61, 150], [70,  148,  73], [175,  54,  60], [231, 199,  31], [187,  86, 149], [8,   133, 161],
    [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85,   85,  85], [52,   52,  52],
  ] as [number, number, number][]
).map(([r, g, b]) => [r / 255, g / 255, b / 255] as [number, number, number]);

// Linearized (gamma-decoded) albedo values for use in the PBR shader
export const MACBETH_LINEAR: readonly [number, number, number][] =
  MACBETH_SRGB.map(([r, g, b]) => [r ** 2.2, g ** 2.2, b ** 2.2] as [number, number, number]);

// Macbeth chart as PBR-compatible MeshData: pos(3)+norm(3)+uv(2), 24 submeshes
// Normal = (0,0,1) — flat card facing +z toward the ref camera
export function generateMacbethChartMesh(totalW: number, totalH: number, gap: number): MeshData {
  const COLS = 6, ROWS = 4;
  const patchW = (totalW - gap * (COLS + 1)) / COLS;
  const patchH = (totalH - gap * (ROWS + 1)) / ROWS;
  const verts: number[] = [];
  const idxs: number[] = [];
  const submeshes: SubMesh[] = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = -totalW / 2 + gap + (patchW + gap) * col;
      const x1 = x0 + patchW;
      const y1 =  totalH / 2 - gap - (patchH + gap) * row;
      const y0 = y1 - patchH;
      const idxStart = idxs.length;
      const base = (verts.length / 8) | 0;
      verts.push(
        x0, y0, 0,  0, 0, 1,  0, 0,
        x1, y0, 0,  0, 0, 1,  1, 0,
        x1, y1, 0,  0, 0, 1,  1, 1,
        x0, y1, 0,  0, 0, 1,  0, 1,
      );
      idxs.push(base, base + 1, base + 2,  base, base + 2, base + 3);
      submeshes.push({ name: `patch_${row * COLS + col}`, start: idxStart, count: 6 });
    }
  }

  return {
    vertices: new Float32Array(verts),
    indices:  new Uint32Array(idxs),
    submeshes,
  };
}
