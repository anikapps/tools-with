/**
 * Pure binary stream utilities for lossless FlateDecode compression and
 * in-place decoding of PDF FlateDecode / raw Image XObjects (RGB, Grayscale, PNG Predictors 10–15).
 * Uses standard Web Streams CompressionStream / DecompressionStream (supported in all modern browsers & Node 22).
 */

export async function deflateBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return input;
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(new Uint8Array(input.buffer, input.byteOffset, input.byteLength) as unknown as BufferSource);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function inflateBytes(input: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(new Uint8Array(input.buffer, input.byteOffset, input.byteLength) as unknown as BufferSource);
    writer.close();
    const chunks: Uint8Array[] = [];
    const reader = ds.readable.getReader();
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  } catch {
    return null;
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Undo PNG row predictors (PDF DecodeParms Predictor 10–15) on decompressed scanlines.
 * Each input row begins with 1 filter-type byte (0=None, 1=Sub, 2=Up, 3=Avg, 4=Paeth).
 */
export function unpredictPngScanlines(
  data: Uint8Array,
  width: number,
  height: number,
  components: number,
  bitsPerComponent = 8
): Uint8Array | null {
  const bpp = Math.max(1, Math.ceil((components * bitsPerComponent) / 8));
  const rowBytes = Math.ceil((width * components * bitsPerComponent) / 8);
  const stride = rowBytes + 1;
  if (data.length < stride * height) return null;

  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = data[y * stride];
    const srcOff = y * stride + 1;
    const dstOff = y * rowBytes;
    const prevOff = (y - 1) * rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const raw = data[srcOff + x];
      const left = x >= bpp ? out[dstOff + x - bpp] : 0;
      const up = y > 0 ? out[prevOff + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prevOff + x - bpp] : 0;

      let val = raw;
      if (filter === 0) {
        val = raw;
      } else if (filter === 1) {
        val = (raw + left) & 0xff;
      } else if (filter === 2) {
        val = (raw + up) & 0xff;
      } else if (filter === 3) {
        val = (raw + ((left + up) >> 1)) & 0xff;
      } else if (filter === 4) {
        val = (raw + paethPredictor(left, up, upLeft)) & 0xff;
      } else {
        return null;
      }
      out[dstOff + x] = val;
    }
  }
  return out;
}

/** Convert raw 8-bit RGB (3 channels) or Grayscale (1 channel) bytes to RGBA ImageData buffer */
export function rawPixelsToRgba(
  raw: Uint8Array,
  width: number,
  height: number,
  components: 1 | 3
): Uint8ClampedArray | null {
  const expected = width * height * components;
  if (raw.length < expected) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (components === 3) {
    for (let i = 0, j = 0; i < expected; i += 3, j += 4) {
      rgba[j] = raw[i];
      rgba[j + 1] = raw[i + 1];
      rgba[j + 2] = raw[i + 2];
      rgba[j + 3] = 255;
    }
  } else {
    for (let i = 0, j = 0; i < expected; i++, j += 4) {
      const g = raw[i];
      rgba[j] = g;
      rgba[j + 1] = g;
      rgba[j + 2] = g;
      rgba[j + 3] = 255;
    }
  }
  return rgba;
}
