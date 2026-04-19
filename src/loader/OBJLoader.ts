export interface MeshData {
  vertices: Float32Array; // interleaved: pos(3) + normal(3) + uv(2)
  indices: Uint32Array;
}

export function parseOBJ(text: string): MeshData {
  const positions: number[][] = [];
  const normals: number[][] = [];
  const uvs: number[][] = [];

  const vertexMap = new Map<string, number>();
  const vertexBuffer: number[] = [];
  const indexBuffer: number[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);

    if (parts[0] === 'v') {
      positions.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (parts[0] === 'vn') {
      normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (parts[0] === 'vt') {
      uvs.push([parseFloat(parts[1]), parseFloat(parts[2] ?? '0')]);
    } else if (parts[0] === 'f') {
      const faceVerts = parts.slice(1).map(token => {
        if (vertexMap.has(token)) return vertexMap.get(token)!;
        const [pi, ti, ni] = token.split('/').map(x => (x ? parseInt(x) - 1 : -1));
        const p = positions[pi] ?? [0,0,0];
        const n = ni >= 0 ? normals[ni] : [0,1,0];
        const t = ti >= 0 ? (uvs[ti] ?? [0,0]) : [0,0];
        const idx = vertexBuffer.length / 8;
        vertexBuffer.push(...p, ...n, ...t);
        vertexMap.set(token, idx);
        return idx;
      });
      // fan-triangulate polygons
      for (let i = 1; i < faceVerts.length - 1; i++) {
        indexBuffer.push(faceVerts[0], faceVerts[i], faceVerts[i+1]);
      }
    }
  }

  // If no normals in file, compute flat normals
  if (normals.length === 0) {
    for (let i = 0; i < indexBuffer.length; i += 3) {
      const getPos = (idx: number): [number,number,number] => {
        const o = idx * 8;
        return [vertexBuffer[o], vertexBuffer[o+1], vertexBuffer[o+2]];
      };
      const a = getPos(indexBuffer[i]);
      const b = getPos(indexBuffer[i+1]);
      const c = getPos(indexBuffer[i+2]);
      const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
      const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
      const nx = ab[1]*ac[2] - ab[2]*ac[1];
      const ny = ab[2]*ac[0] - ab[0]*ac[2];
      const nz = ab[0]*ac[1] - ab[1]*ac[0];
      const len = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
      for (let v = 0; v < 3; v++) {
        const o = indexBuffer[i+v] * 8;
        vertexBuffer[o+3] = nx/len;
        vertexBuffer[o+4] = ny/len;
        vertexBuffer[o+5] = nz/len;
      }
    }
  }

  return {
    vertices: new Float32Array(vertexBuffer),
    indices: new Uint32Array(indexBuffer),
  };
}
