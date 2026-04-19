import { unzlibSync } from 'fflate';
import type { MeshData } from './OBJLoader';

interface FBXNode {
  name: string;
  props: unknown[];
  children: FBXNode[];
}

function parseBinaryFBX(buffer: ArrayBuffer): FBXNode {
  const bytes = new Uint8Array(buffer);
  const dv    = new DataView(buffer);
  const magic = new TextDecoder().decode(bytes.subarray(0, 20));
  if (!magic.startsWith('Kaydara FBX Binary')) throw new Error('Not a binary FBX file — ASCII FBX is not supported');

  const version = dv.getUint32(23, true);
  const is64    = version >= 7500;
  let off = 27;

  function readNode(): FBXNode | null {
    let end: number, nProps: number;
    if (is64) {
      end    = dv.getUint32(off, true) + dv.getUint32(off + 4, true) * 4294967296;
      nProps = dv.getUint32(off + 8, true);
      off   += 24;
    } else {
      end    = dv.getUint32(off, true);
      nProps = dv.getUint32(off + 4, true);
      off   += 12;
    }
    if (end === 0) { off += 1; return null; }

    const nameLen = bytes[off++];
    const name    = new TextDecoder().decode(bytes.subarray(off, off + nameLen));
    off += nameLen;

    const props: unknown[] = [];
    for (let i = 0; i < nProps; i++) {
      const t = String.fromCharCode(bytes[off++]);
      switch (t) {
        case 'Y': props.push(dv.getInt16(off, true));   off += 2; break;
        case 'C': props.push(bytes[off++] !== 0);               break;
        case 'I': props.push(dv.getInt32(off, true));   off += 4; break;
        case 'F': props.push(dv.getFloat32(off, true)); off += 4; break;
        case 'D': props.push(dv.getFloat64(off, true)); off += 8; break;
        case 'L': props.push(dv.getUint32(off, true) + dv.getUint32(off + 4, true) * 4294967296); off += 8; break;
        case 'S': case 'R': {
          const len = dv.getUint32(off, true); off += 4;
          props.push(t === 'S'
            ? new TextDecoder().decode(bytes.subarray(off, off + len))
            : bytes.slice(off, off + len));
          off += len; break;
        }
        case 'f': case 'd': case 'i': case 'l': case 'b': {
          const arrLen  = dv.getUint32(off,     true);
          const enc     = dv.getUint32(off + 4, true);
          const compLen = dv.getUint32(off + 8, true);
          off += 12;
          const rawSlice = bytes.subarray(off, off + compLen);
          const raw: Uint8Array<ArrayBuffer> = enc === 1 ? unzlibSync(rawSlice) as Uint8Array<ArrayBuffer> : rawSlice;
          off += compLen;
          const rdv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
          if (t === 'f') {
            const a = new Float32Array(arrLen);
            for (let j = 0; j < arrLen; j++) a[j] = rdv.getFloat32(j * 4, true);
            props.push(a);
          } else if (t === 'd') {
            const a = new Float64Array(arrLen);
            for (let j = 0; j < arrLen; j++) a[j] = rdv.getFloat64(j * 8, true);
            props.push(a);
          } else if (t === 'i') {
            const a = new Int32Array(arrLen);
            for (let j = 0; j < arrLen; j++) a[j] = rdv.getInt32(j * 4, true);
            props.push(a);
          } else if (t === 'l') {
            const a = new Float64Array(arrLen);
            for (let j = 0; j < arrLen; j++) a[j] = rdv.getUint32(j * 8, true) + rdv.getUint32(j * 8 + 4, true) * 4294967296;
            props.push(a);
          } else {
            const a: boolean[] = [];
            for (let j = 0; j < arrLen; j++) a.push(raw[j] !== 0);
            props.push(a);
          }
          break;
        }
        default: throw new Error(`FBX: unknown property type '${t}'`);
      }
    }

    const sentinel = is64 ? 25 : 13;
    const children: FBXNode[] = [];
    while (off < end - sentinel) {
      const child = readNode();
      if (!child) break;
      children.push(child);
    }
    off = end;
    return { name, props, children };
  }

  const root: FBXNode = { name: '', props: [], children: [] };
  while (off < buffer.byteLength - (is64 ? 25 : 13)) {
    const n = readNode();
    if (!n) break;
    root.children.push(n);
  }
  return root;
}

function ch(node: FBXNode, name: string): FBXNode | undefined {
  return node.children.find(c => c.name === name);
}
function chProp<T>(node: FBXNode | undefined, childName: string, pi = 0): T | undefined {
  if (!node) return undefined;
  return ch(node, childName)?.props[pi] as T | undefined;
}
function asF64(v: unknown): Float64Array | null {
  if (!v) return null;
  if (v instanceof Float64Array) return v;
  if (v instanceof Float32Array) { const a = new Float64Array(v.length); for (let i = 0; i < v.length; i++) a[i] = v[i]; return a; }
  return null;
}

export function parseFBX(buffer: ArrayBuffer): MeshData {
  const root    = parseBinaryFBX(buffer);
  const objects = root.children.find(c => c.name === 'Objects');
  if (!objects) throw new Error('FBX: no Objects node');

  const geoNodes = objects.children.filter(c => c.name === 'Geometry');
  if (!geoNodes.length) throw new Error('FBX: no Geometry found');
  const geo = geoNodes.find(g => g.props[2] === 'Mesh') ?? geoNodes[0];

  // Positions and polygon index
  const rawPos = asF64(ch(geo, 'Vertices')?.props[0]);
  if (!rawPos) throw new Error('FBX: no Vertices');
  const pvIdx = ch(geo, 'PolygonVertexIndex')?.props[0] as Int32Array | undefined;
  if (!pvIdx) throw new Error('FBX: no PolygonVertexIndex');

  // Normals
  const normLayer   = ch(geo, 'LayerElementNormal');
  const rawNormals  = asF64(ch(normLayer!, 'Normals')?.props[0]);
  const normMapping = (chProp<string>(normLayer, 'MappingInformationType') ?? 'ByPolygonVertex');
  const normRef     = (chProp<string>(normLayer, 'ReferenceInformationType') ?? 'Direct');
  const normIdxArr  = normRef === 'IndexToDirect' ? chProp<Int32Array>(normLayer, 'NormalsIndex') ?? null : null;

  // UVs
  const uvLayer   = ch(geo, 'LayerElementUV');
  const rawUVs    = asF64(ch(uvLayer!, 'UV')?.props[0]);
  const uvMapping = (chProp<string>(uvLayer, 'MappingInformationType') ?? 'ByPolygonVertex');
  const uvRef     = (chProp<string>(uvLayer, 'ReferenceInformationType') ?? 'IndexToDirect');
  const uvIdxArr  = uvRef === 'IndexToDirect' ? chProp<Int32Array>(uvLayer, 'UVIndex') ?? null : null;

  const outVerts: number[] = [];
  const outIdx:   number[] = [];
  const vertMap = new Map<string, number>();

  function resolveNorm(pv: number, vi: number): [number, number, number] {
    if (!rawNormals) return [0, 1, 0];
    const ni = normMapping === 'ByPolygonVertex'
      ? (normRef === 'IndexToDirect' ? normIdxArr![pv] : pv)
      : (normRef === 'IndexToDirect' ? normIdxArr![vi] : vi);
    return [rawNormals[ni * 3], rawNormals[ni * 3 + 1], rawNormals[ni * 3 + 2]];
  }

  function resolveUV(pv: number, vi: number): [number, number] {
    if (!rawUVs) return [0, 0];
    const ui = uvMapping === 'ByPolygonVertex'
      ? (uvRef === 'IndexToDirect' ? uvIdxArr![pv] : pv)
      : (uvRef === 'IndexToDirect' ? uvIdxArr![vi] : vi);
    return [rawUVs[ui * 2], rawUVs[ui * 2 + 1]];
  }

  function emit(pv: number): number {
    const raw = pvIdx![pv];
    const vi  = raw < 0 ? ~raw : raw;
    const [nx, ny, nz] = resolveNorm(pv, vi);
    const [u, v]       = resolveUV(pv, vi);

    // Key on resolved attribute indices so identical attributes share a vertex
    const ni = rawNormals
      ? (normMapping === 'ByPolygonVertex' ? (normRef === 'IndexToDirect' ? normIdxArr![pv] : pv) : (normRef === 'IndexToDirect' ? normIdxArr![vi] : vi))
      : -1;
    const ui = rawUVs
      ? (uvMapping === 'ByPolygonVertex' ? (uvRef === 'IndexToDirect' ? uvIdxArr![pv] : pv) : (uvRef === 'IndexToDirect' ? uvIdxArr![vi] : vi))
      : -1;
    const key = `${vi}:${ni}:${ui}`;

    let idx = vertMap.get(key);
    if (idx === undefined) {
      idx = outVerts.length / 8;
      vertMap.set(key, idx);
      outVerts.push(rawPos![vi*3], rawPos![vi*3+1], rawPos![vi*3+2], nx, ny, nz, u, v);
    }
    return idx;
  }

  let polyStart = 0;
  for (let i = 0; i < pvIdx.length; i++) {
    if (pvIdx[i] < 0) {
      const polyLen = i - polyStart + 1;
      if (polyLen >= 3) {
        const i0 = emit(polyStart);
        for (let t = 1; t < polyLen - 1; t++) {
          outIdx.push(i0, emit(polyStart + t), emit(polyStart + t + 1));
        }
      }
      polyStart = i + 1;
    }
  }

  // Generate flat normals when the mesh has none
  if (!rawNormals) {
    for (let i = 0; i < outIdx.length; i += 3) {
      const a = outIdx[i]*8, b = outIdx[i+1]*8, c = outIdx[i+2]*8;
      const ax = outVerts[b]-outVerts[a],   ay = outVerts[b+1]-outVerts[a+1], az = outVerts[b+2]-outVerts[a+2];
      const bx = outVerts[c]-outVerts[a],   by = outVerts[c+1]-outVerts[a+1], bz = outVerts[c+2]-outVerts[a+2];
      const cx = ay*bz - az*by, cy = az*bx - ax*bz, cz = ax*by - ay*bx;
      const len = Math.sqrt(cx*cx + cy*cy + cz*cz) || 1;
      for (const ii of [a, b, c]) { outVerts[ii+3]=cx/len; outVerts[ii+4]=cy/len; outVerts[ii+5]=cz/len; }
    }
  }

  return { vertices: new Float32Array(outVerts), indices: new Uint32Array(outIdx) };
}
