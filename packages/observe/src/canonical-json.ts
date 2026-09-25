/**
 * @clapp/observe — canonical JSON serialization for capture payloads.
 *
 * Determinism contract (what makes capture sequences replay-comparable):
 * - object keys are sorted by UTF-16 code unit order (the default
 *   `Array.prototype.sort()` on strings — stable across JS engines);
 * - strings escape exactly as `JSON.stringify` does (spec-mandated, stable:
 *   short escapes for `"` `\` `\b` `\f` `\n` `\r` `\t`, `\u00xx` lowercase
 *   for other control chars, well-formed lone-surrogate escapes);
 * - numbers use the shortest round-trip decimal representation;
 * - arrays keep element order (document order IS evidence);
 * - only plain JSON data is canonicalizable: `undefined`, non-finite
 *   numbers, class instances, Dates, Maps, and binary buffers THROW —
 *   channels must sanitize page data BEFORE it reaches a CaptureRecord
 *   (see logs/runtime.ts `sanitizeConsoleArg`, dom-kit in-page JSON).
 *
 * The throwing behavior is deliberate: canonicalization is the last line of
 * defense before bytes are hashed for provenance, so a non-canonicalizable
 * payload is a channel bug we want loud, not silently mangled.
 */

/** Maximum nesting depth before canonicalization refuses the payload. */
const MAX_DEPTH = 96;

/** Raised when a value cannot be canonical-JSON serialized. Carries the
 *  JSON-pointer-ish path of the offending node for debugging. */
export class CanonicalJsonError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} (at ${path})`);
    this.name = 'CanonicalJsonError';
  }
}

const encoder = new TextEncoder();

/** Deterministic JSON text for a canonical-serializable value. */
export function canonicalJson(value: unknown): string {
  const parts: string[] = [];
  writeCanonical(value, 0, parts, '$');
  return parts.join('');
}

/** Canonical text plus its UTF-8 byte length (for buffer-bound accounting). */
export function canonicalJsonBytes(value: unknown): { text: string; byteLength: number } {
  const text = canonicalJson(value);
  return { text, byteLength: encoder.encode(text).byteLength };
}

/** Total, non-throwing serializability check. */
export function isCanonicalSerializable(value: unknown): boolean {
  try {
    canonicalJson(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deep-removes `undefined`-valued object properties (array `undefined`
 * elements become `null` to preserve positions). `JSON.stringify` drops
 * undefined properties silently; canonicalization instead REJECTS them —
 * so channels pass payloads through this pruner to keep "absent" and
 * "explicitly undefined" indistinguishable, which is what a JSON payload
 * semantics wants anyway.
 */
export function pruneUndefined(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value === undefined ? null : value;
  }
  if (Array.isArray(value)) {
    return value.map((element) => pruneUndefined(element));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const inner = (value as Record<string, unknown>)[key];
    if (inner !== undefined) {
      out[key] = pruneUndefined(inner);
    }
  }
  return out;
}

/** Structural plainness check: only `Object.prototype`-rooted (or null-proto)
 *  objects are canonical data; everything else is a program value. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function writeCanonical(value: unknown, depth: number, out: string[], path: string): void {
  if (value === null) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError('non-finite number is not canonical-JSON serializable', path);
      }
      out.push(JSON.stringify(value));
      return;
    case 'string':
      out.push(JSON.stringify(value));
      return;
    case 'object':
      break;
    default:
      throw new CanonicalJsonError(`value of type ${typeof value} is not canonical-JSON serializable`, path);
  }

  if (depth >= MAX_DEPTH) {
    throw new CanonicalJsonError(`nesting deeper than ${MAX_DEPTH} levels`, path);
  }

  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      writeCanonical(value[i], depth + 1, out, `${path}[${i}]`);
    }
    out.push(']');
    return;
  }

  if (!isPlainObject(value)) {
    throw new CanonicalJsonError('class instance or non-plain object is not canonical-JSON serializable', path);
  }

  const keys = Object.keys(value).sort();
  out.push('{');
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (i > 0) out.push(',');
    out.push(JSON.stringify(key), ':');
    writeCanonical((value as Record<string, unknown>)[key], depth + 1, out, `${path}.${key}`);
  }
  out.push('}');
}
