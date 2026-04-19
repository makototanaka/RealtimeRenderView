import { unzlibSync } from 'fflate';

export interface HDRImage {
  width: number;
  height: number;
  data: Float32Array; // RGBA, row-major, linear
}

function halfToFloat(h: number): number {
  const s = (h >> 15) & 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0)  return (s ? -1 : 1) * (m / 1024) * 2 ** -14;
  if (e === 31) return m === 0 ? (s ? -Infinity : Infinity) : NaN;
  return (s ? -1 : 1) * (1 + m / 1024) * 2 ** (e - 15);
}

function undoPredictor(src: Uint8Array): Uint8Array {
  const n = src.length;
  const tmp = new Uint8Array(src);
  // Undo delta encoding
  for (let i = 1; i < n; i++) tmp[i] = (tmp[i - 1] + tmp[i] - 128) & 0xff;
  // Undo byte reordering
  const out = new Uint8Array(n);
  const half = (n + 1) >> 1;
  let s = 0;
  for (let i = 0; i < half; i++) {
    out[s++] = tmp[i];
    if (half + i < n) out[s++] = tmp[half + i];
  }
  return out;
}

function readNullStr(buf: Uint8Array, off: number): { str: string; end: number } {
  let end = off;
  while (buf[end] !== 0) end++;
  return { str: new TextDecoder().decode(buf.subarray(off, end)), end: end + 1 };
}

export function loadEXR(buffer: ArrayBuffer): HDRImage {
  const bytes = new Uint8Array(buffer);
  const dv    = new DataView(buffer);

  if (dv.getUint32(0, true) !== 0x01312f76) throw new Error('Not an EXR file');
  const version = dv.getUint32(4, true);
  if (version & 0x200) throw new Error('Multi-part EXR not supported');

  let off = 8;
  let width = 0, height = 0, yMin = 0;
  let compression = 0;
  const channels: { name: string; pixelType: number }[] = [];

  // ── parse header ────────────────────────────────────────────────────────────
  while (true) {
    const attrName = readNullStr(bytes, off); off = attrName.end;
    if (attrName.str === '') break;

    const _typeName = readNullStr(bytes, off); off = _typeName.end;
    const size = dv.getInt32(off, true); off += 4;
    const adv  = new DataView(buffer, off, size);

    if (attrName.str === 'dataWindow') {
      // box2i: xMin yMin xMax yMax (each int32 LE)
      yMin   = adv.getInt32(4,  true);
      width  = adv.getInt32(8,  true) - adv.getInt32(0, true) + 1;
      height = adv.getInt32(12, true) - yMin + 1;

    } else if (attrName.str === 'compression') {
      compression = adv.getUint8(0);

    } else if (attrName.str === 'channels') {
      // channel list: repeated (name\0 + pixelType(4) + pLinear(1) + pad(3) + xSamp(4) + ySamp(4))
      // terminated by a single \0 byte
      let co = 0;
      while (co < size && adv.getUint8(co) !== 0) {
        const nameStart = co;
        while (adv.getUint8(co) !== 0) co++;
        const name = new TextDecoder().decode(new Uint8Array(buffer, off + nameStart, co - nameStart));
        co++; // skip null terminator
        const pixelType = adv.getInt32(co, true);
        co += 4 + 1 + 3 + 4 + 4; // pixelType + pLinear + reserved(3) + xSampling + ySampling
        channels.push({ name, pixelType });
      }
    }

    off += size;
  }

  if (!width || !height)    throw new Error('EXR missing dataWindow');
  if (!channels.length)     throw new Error('EXR has no channels');
  if (![0, 2, 3].includes(compression))
    throw new Error(`Unsupported EXR compression: ${compression} (supported: 0=none, 2=ZIPS, 3=ZIP)`);

  channels.sort((a, b) => a.name < b.name ? -1 : 1);

  const linesPerBlock = compression === 3 ? 16 : 1;
  const numBlocks     = Math.ceil(height / linesPerBlock);

  // ── read offset table ───────────────────────────────────────────────────────
  const blockOffsets: number[] = [];
  for (let i = 0; i < numBlocks; i++) {
    const lo = dv.getUint32(off,     true);
    const hi = dv.getUint32(off + 4, true);
    blockOffsets.push(lo + hi * 0x100000000);
    off += 8;
  }

  // ── output buffer ───────────────────────────────────────────────────────────
  const out = new Float32Array(width * height * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 1; // default alpha = 1

  // ── decode blocks ───────────────────────────────────────────────────────────
  for (let block = 0; block < numBlocks; block++) {
    const bOff     = blockOffsets[block];
    const yCoord   = dv.getInt32(bOff,     true);
    const dataSize = dv.getInt32(bOff + 4, true);
    const raw      = bytes.subarray(bOff + 8, bOff + 8 + dataSize);

    const scanCount = Math.min(linesPerBlock, height - (yCoord - yMin));

    let pix: Uint8Array;
    if (compression === 0) {
      pix = raw;
    } else {
      pix = undoPredictor(unzlibSync(raw));
    }

    // scanline data layout: for each scanline → for each channel → all pixels
    let po = 0;
    for (let si = 0; si < scanCount; si++) {
      const row = yCoord - yMin + si;
      for (const { name, pixelType } of channels) {
        const key = name.toUpperCase();
        for (let x = 0; x < width; x++) {
          let val: number;
          if (pixelType === 2) { // FLOAT32
            val = new DataView(pix.buffer, pix.byteOffset + po, 4).getFloat32(0, true);
            po += 4;
          } else { // HALF (pixelType 1) or UINT (0, treat as half for now)
            val = halfToFloat(pix[po] | (pix[po + 1] << 8));
            po += 2;
          }
          const idx = (row * width + x) * 4;
          if      (key === 'R') out[idx]     = val;
          else if (key === 'G') out[idx + 1] = val;
          else if (key === 'B') out[idx + 2] = val;
          else if (key === 'A') out[idx + 3] = val;
        }
      }
    }
  }

  return { width, height, data: out };
}
