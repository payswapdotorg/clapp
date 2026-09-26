/**
 * @clapp/diffext — zero-dependency PNG codec (CLAPP-041).
 *
 * The visual dimension must compare screenshot PIXELS without pulling an
 * unaudited npm image library into the verification path. This module is
 * the documented zero-dep alternative: a strict PNG decoder + encoder on
 * node:zlib (inflateSync/deflateSync) and a local CRC-32, nothing else.
 * It decodes what headless-chromium screenshot PNGs are (and more):
 *
 * SUPPORTED (validated, then normalized to RGBA):
 * - color types 0 (grayscale), 2 (truecolor RGB), 3 (palette + PLTE),
 *   4 (grayscale + alpha), 6 (truecolor + alpha);
 * - bit depth 8 ONLY (every screenshot encoder emits 8-bit; 1/2/4/16-bit
 *   are rejected with a clear error — honest refusal, not silent mangling);
 * - non-interlaced ONLY (Adam7 is rejected — playwright/chromium never
 *   interlace screenshots);
 * - tRNS transparency for palette images (the grayscale/truecolor tRNS
 *   corner is rejected explicitly);
 * - multiple IDAT chunks (concatenated before inflate), chunk CRCs
 *   verified, decompressed size checked.
 *
 * encodePng is the inverse codec (filter-0 rows, deflate, correct CRCs).
 * It exists so the test battery can synthesize pixel-exact fixtures AND
 * round-trip the decoder against itself without any external bytes.
 */

import { deflateSync, inflateSync } from 'node:zlib';

/** Raised on malformed/unsupported PNG input (never silently approximated). */
export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngError';
  }
}

/** A decoded image, always normalized to 4 channels (RGBA), 8 bits each. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** length === width * height * 4 */
  readonly rgba: Uint8Array;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG color type → samples per pixel. */
const COLOR_TYPE_CHANNELS: Readonly<Record<number, number>> = {
  0: 1, // grayscale
  2: 3, // truecolor
  3: 1, // palette index
  4: 2, // grayscale + alpha
  6: 4, // truecolor + alpha
};

// ---------------------------------------------------------------------------
// CRC-32 (IEEE, as the PNG spec mandates)
// ---------------------------------------------------------------------------

const CRC_TABLE: Readonly<Uint32Array> = (() => {
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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Byte cursor (bounds-checked reads)
// ---------------------------------------------------------------------------

class Cursor {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  remaining(): number {
    return this.bytes.length - this.offset;
  }

  byte(): number {
    if (this.remaining() < 1) {
      throw new PngError(`PNG truncated: wanted 1 byte at ${this.offset}, have ${this.remaining()}`);
    }
    const value = this.bytes[this.offset]!;
    this.offset += 1;
    return value;
  }

  uint32BE(): number {
    if (this.remaining() < 4) {
      throw new PngError(`PNG truncated: wanted 4 bytes at ${this.offset}, have ${this.remaining()}`);
    }
    const value =
      (this.bytes[this.offset]! * 0x1000000 +
        this.bytes[this.offset + 1]! * 0x10000 +
        this.bytes[this.offset + 2]! * 0x100 +
        this.bytes[this.offset + 3]!) >>>
      0;
    this.offset += 4;
    return value;
  }

  slice(length: number): Uint8Array {
    if (length < 0 || this.remaining() < length) {
      throw new PngError(`PNG truncated: wanted ${length} bytes at ${this.offset}, have ${this.remaining()}`);
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  ascii(length: number): string {
    let out = '';
    for (let index = 0; index < length; index += 1) {
      out += String.fromCharCode(this.byte());
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/** Everything the chunk walk gathers before pixel decoding. */
interface PngContents {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  palette: Uint8Array | null;
  transparency: Uint8Array | null;
  compressed: Uint8Array | null;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Walks the chunk stream: signature, CRC checks, IHDR/PLTE/tRNS/IDAT/IEND. */
function readContents(bytes: Uint8Array): PngContents {
  const cursor = new Cursor(bytes);
  for (const expected of PNG_SIGNATURE) {
    const actual = cursor.byte();
    if (actual !== expected) {
      throw new PngError(`not a PNG: bad signature byte ${actual} (wanted ${expected})`);
    }
  }

  const idatChunks: Uint8Array[] = [];
  let header: { width: number; height: number; bitDepth: number; colorType: number; interlace: number } | null = null;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  let sawIend = false;

  while (true) {
    if (cursor.remaining() === 0) {
      throw new PngError('PNG ends without an IEND chunk');
    }
    const length = cursor.uint32BE();
    const type = cursor.ascii(4);
    const data = cursor.slice(length);
    const crc = cursor.uint32BE();
    const crcInput = concatBytes([
      Uint8Array.from(type, (char) => char.charCodeAt(0)),
      data,
    ]);
    if (crc32(crcInput) !== crc) {
      throw new PngError(`PNG chunk ${type} fails its CRC check (corrupt bytes)`);
    }

    if (type === 'IHDR') {
      if (header !== null) {
        throw new PngError('PNG declares two IHDR chunks');
      }
      if (length !== 13) {
        throw new PngError(`PNG IHDR must be 13 bytes, got ${length}`);
      }
      // Canonical IHDR order: width(4) height(4) depth(1) color(1)
      // compression(1) filter(1) interlace(1).
      const inner = new Cursor(data);
      const width = inner.uint32BE();
      const height = inner.uint32BE();
      const bitDepth = inner.byte();
      const colorType = inner.byte();
      const compression = inner.byte();
      const filterMethod = inner.byte();
      const interlace = inner.byte();
      if (compression !== 0 || filterMethod !== 0) {
        throw new PngError('PNG IHDR declares non-standard compression/filter methods');
      }
      header = { width, height, bitDepth, colorType, interlace };
    } else if (type === 'PLTE') {
      if (length % 3 !== 0 || length > 256 * 3) {
        throw new PngError(`PNG PLTE length ${length} is invalid`);
      }
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      sawIend = true;
      break;
    } else if (type.charCodeAt(0) < 0x61) {
      // Ancillary chunks (lowercase first letter: gAMA, pHYs, tEXt, …) are
      // skipped — they never affect pixels. Anything else critical that
      // this decoder does not implement is a hard error per the PNG spec.
      throw new PngError(`PNG carries unhandled critical chunk ${type}`);
    }
  }

  if (header === null) {
    throw new PngError('PNG has no IHDR chunk');
  }
  if (!sawIend) {
    throw new PngError('PNG has no IEND chunk');
  }
  if (idatChunks.length === 0) {
    throw new PngError('PNG has no IDAT chunks');
  }
  return {
    ...header,
    palette,
    transparency,
    compressed: concatBytes(idatChunks),
  };
}

/** PNG unfiltering (RFC 2083 filters 0-4). */
function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  const bpp = channels;
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    if (position >= raw.length) {
      throw new PngError(`PNG pixel data truncated at row ${y}`);
    }
    const filter = raw[position]!;
    position += 1;
    const rowStart = y * stride;
    const priorStart = rowStart - stride;
    for (let x = 0; x < stride; x += 1) {
      if (position >= raw.length) {
        throw new PngError(`PNG pixel data truncated at row ${y}, byte ${x}`);
      }
      const value = raw[position]!;
      position += 1;
      const left = x >= bpp ? out[rowStart + x - bpp]! : 0;
      const up = y > 0 ? out[priorStart + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? out[priorStart + x - bpp]! : 0;
      let reconstructed: number;
      switch (filter) {
        case 0:
          reconstructed = value;
          break;
        case 1:
          reconstructed = value + left;
          break;
        case 2:
          reconstructed = value + up;
          break;
        case 3:
          reconstructed = value + ((left + up) >> 1);
          break;
        case 4:
          reconstructed = value + paeth(left, up, upLeft);
          break;
        default:
          throw new PngError(`PNG row ${y} declares unknown filter ${filter}`);
      }
      out[rowStart + x] = reconstructed & 0xff;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Expands unfiltered sample bytes to normalized RGBA. */
function toRgba(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  colorType: number,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const source = index * channels;
    const target = index * 4;
    switch (colorType) {
      case 0: {
        const gray = pixels[source]!;
        out[target] = gray;
        out[target + 1] = gray;
        out[target + 2] = gray;
        out[target + 3] = 255;
        break;
      }
      case 2: {
        out[target] = pixels[source]!;
        out[target + 1] = pixels[source + 1]!;
        out[target + 2] = pixels[source + 2]!;
        out[target + 3] = 255;
        break;
      }
      case 3: {
        if (palette === null) {
          throw new PngError('PNG palette image carries no PLTE chunk');
        }
        const paletteIndex = pixels[source]!;
        const entry = paletteIndex * 3;
        if (entry + 2 >= palette.length) {
          throw new PngError(`PNG palette index ${paletteIndex} exceeds PLTE (${palette.length / 3} entries)`);
        }
        out[target] = palette[entry]!;
        out[target + 1] = palette[entry + 1]!;
        out[target + 2] = palette[entry + 2]!;
        out[target + 3] =
          transparency !== null && paletteIndex < transparency.length ? transparency[paletteIndex]! : 255;
        break;
      }
      case 4: {
        const gray = pixels[source]!;
        out[target] = gray;
        out[target + 1] = gray;
        out[target + 2] = gray;
        out[target + 3] = pixels[source + 1]!;
        break;
      }
      case 6: {
        out[target] = pixels[source]!;
        out[target + 1] = pixels[source + 1]!;
        out[target + 2] = pixels[source + 2]!;
        out[target + 3] = pixels[source + 3]!;
        break;
      }
      default:
        throw new PngError(`PNG color type ${colorType} is not one of 0/2/3/4/6`);
    }
  }
  return out;
}

/** Decodes a PNG to normalized RGBA. Throws {@link PngError} on anything unsupported or corrupt. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  const contents = readContents(bytes);
  const { width, height, bitDepth, colorType, interlace, palette, transparency, compressed } = contents;
  const channels = COLOR_TYPE_CHANNELS[colorType];
  if (channels === undefined) {
    throw new PngError(`PNG color type ${colorType} is not one of 0/2/3/4/6`);
  }
  if (bitDepth !== 8) {
    throw new PngError(`PNG bit depth ${bitDepth} is unsupported (8-bit only — see module doc)`);
  }
  if (interlace !== 0) {
    throw new PngError('PNG interlacing (Adam7) is unsupported (see module doc)');
  }
  if (width <= 0 || height <= 0) {
    throw new PngError(`PNG dimensions ${width}x${height} are not positive`);
  }
  if (colorType !== 3 && transparency !== null) {
    throw new PngError('PNG tRNS for non-palette images is unsupported (see module doc)');
  }
  if (compressed === null) {
    throw new PngError('PNG has no IDAT chunks');
  }
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(compressed));
  } catch (error) {
    throw new PngError(`PNG zlib stream failed to inflate: ${String(error)}`);
  }
  const expected = (width * channels + 1) * height;
  if (raw.length !== expected) {
    throw new PngError(`PNG decompressed to ${raw.length} bytes; the header implies ${expected}`);
  }
  const pixels = unfilter(raw, width, height, channels);
  const rgba = toRgba(pixels, width, height, channels, colorType, palette, transparency);
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------
// Encoder (filter-0 rows → deflate → chunks with CRCs)
// ---------------------------------------------------------------------------

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < type.length; index += 1) {
    out[4 + index] = type.charCodeAt(index);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encodes RGBA pixels as a minimal valid PNG (color type 6, filter 0). */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, rgba } = image;
  if (width <= 0 || height <= 0) {
    throw new PngError(`cannot encode ${width}x${height}: dimensions must be positive`);
  }
  if (rgba.length !== width * height * 4) {
    throw new PngError(`cannot encode: rgba length ${rgba.length} ≠ ${width * height * 4}`);
  }
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive set (rows carry their own type)
  ihdr[12] = 0; // interlace: none
  const idat = new Uint8Array(deflateSync(raw, { level: 9 }));
  return concatBytes([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]);
}

/** Byte equality (the visual fast path: identical bytes ⇒ identical pixels). */
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index]! ^ right[index]!;
  }
  return diff === 0;
}
