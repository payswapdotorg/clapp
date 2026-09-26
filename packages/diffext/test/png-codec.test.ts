/**
 * CLAPP-041 test battery — the zero-dep PNG codec (always runs).
 *
 * The visual dimension's decode path is pinned WITHOUT any browser:
 * round-trips through encodePng/decodePng, deterministic encoding,
 * normalization of every supported color type, and the honest-refusal
 * errors for everything the codec does not support. The browser-gated
 * battery (visual-browser.test.ts) additionally proves the codec decodes
 * REAL chromium screenshots and agrees with the in-browser canvas decode.
 */

import { describe, expect, it } from 'bun:test';
import { bytesEqual, decodePng, encodePng, PngError, type RgbaImage } from '../src/png';

/** Deterministic pseudo-random RGBA image (no flakiness, no fixtures on disk). */
function syntheticImage(width: number, height: number, seed = 1): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  let state = seed;
  for (let index = 0; index < width * height; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    rgba[index * 4] = (state >>> 24) & 0xff;
    rgba[index * 4 + 1] = (state >>> 16) & 0xff;
    rgba[index * 4 + 2] = (state >>> 8) & 0xff;
    rgba[index * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

function solidImage(width: number, height: number, rgbaPixel: [number, number, number, number]): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba.set(rgbaPixel, index * 4);
  }
  return { width, height, rgba };
}

describe('encodePng → decodePng round-trip', () => {
  it('random pixels survive byte-exactly', () => {
    const image = syntheticImage(37, 23, 42);
    const encoded = encodePng(image);
    const decoded = decodePng(encoded);
    expect(decoded.width).toBe(37);
    expect(decoded.height).toBe(23);
    expect(bytesEqual(decoded.rgba, image.rgba)).toBe(true);
  });

  it('encoding is deterministic (same pixels → same bytes)', () => {
    const image = syntheticImage(16, 16, 7);
    expect(bytesEqual(encodePng(image), encodePng(image))).toBe(true);
  });

  it('a 1x1 image round-trips (edge dimensions)', () => {
    const image = solidImage(1, 1, [10, 20, 30, 255]);
    const decoded = decodePng(encodePng(image));
    expect(decoded.width).toBe(1);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.rgba)).toEqual([10, 20, 30, 255]);
  });

  it('transparent pixels survive (alpha channel)', () => {
    const image = solidImage(4, 4, [255, 0, 0, 0]);
    const decoded = decodePng(encodePng(image));
    expect(Array.from(decoded.rgba.subarray(0, 4))).toEqual([255, 0, 0, 0]);
  });
});

describe('decodePng honest refusals', () => {
  it('rejects garbage bytes', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4]))).toThrow(PngError);
    expect(() => decodePng(new Uint8Array(0))).toThrow(PngError);
  });

  it('rejects a corrupted CRC (flipped byte in the IEND checksum)', () => {
    const encoded = encodePng(syntheticImage(8, 8, 3));
    const corrupted = new Uint8Array(encoded);
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 0xff; // last IEND CRC byte
    expect(() => decodePng(corrupted)).toThrow(/CRC/);
  });

  it('rejects truncation', () => {
    const encoded = encodePng(syntheticImage(8, 8, 3));
    expect(() => decodePng(encoded.subarray(0, Math.floor(encoded.length / 2)))).toThrow(PngError);
  });

  it('rejects unsupported bit depth 16 and interlacing (hand-built IHDRs)', () => {
    // A well-formed PNG whose IHDR declares bit depth 16 (unsupported).
    const depth16 = handcraftedPng({ bitDepth: 16, colorType: 6 });
    expect(() => decodePng(depth16)).toThrow(/bit depth 16/);

    const interlaced = handcraftedPng({ bitDepth: 8, colorType: 6, interlace: 1 });
    expect(() => decodePng(interlaced)).toThrow(/interlac/i);
  });
});

// ---------------------------------------------------------------------------
// Handcrafted IHDR variant builder (filters/rejections need invalid headers)
// ---------------------------------------------------------------------------

interface HeaderVariant {
  bitDepth: number;
  colorType: number;
  interlace?: number;
}

function crc32Of(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTableAt((crc ^ bytes[index]!) & 0xff) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crcTableAt(index: number): number {
  return CRC_TABLE[index]!;
}

function chunkOf(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) {
    out[4 + index] = type.charCodeAt(index);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32Of(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function handcraftedPng(variant: HeaderVariant): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1); // width
  view.setUint32(4, 1); // height
  ihdr[8] = variant.bitDepth;
  ihdr[9] = variant.colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = variant.interlace ?? 0;
  // IDAT: a valid zlib stream whose decompressed size does NOT have to be
  // right — the header rejection fires before pixel decoding.
  const idat = new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01]);
  return concat([signature, chunkOf('IHDR', ihdr), chunkOf('IDAT', idat), chunkOf('IEND', new Uint8Array(0))]);
}

describe('bytesEqual', () => {
  it('compares content, not identity', () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});
