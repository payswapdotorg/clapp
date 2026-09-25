/**
 * Canonical JSON serialization for CLAPP evidence hashing.
 *
 * The canonical form is the single byte-level ground truth every evidence
 * hash in this package is computed over (CaptureRecord bytes, EvidenceBundle
 * manifests, and verbatim comparisons inside `verify`). Its rules are
 * deliberately strict and total:
 *
 * - Objects: plain records only (prototype `Object.prototype` or `null`);
 *   keys are serialized in UTF-16 code-unit order (`Array#sort()` default,
 *   matching the @clapp/store `stableStringify` convention), recursively.
 * - Arrays: element order preserved, recursively.
 * - Strings: the ECMAScript well-formed JSON escaping (exactly what
 *   `JSON.stringify` produces for a string — `\"`, `\\`, control escapes,
 *   `\u00xx` for other control chars, `\uXXXX` for lone surrogates;
 *   non-ASCII characters are emitted verbatim).
 * - Numbers: finite values only, serialized with the ECMAScript
 *   shortest-round-trip number-to-string form (`-0` normalizes to `0`);
 *   `NaN`/`Infinity` are rejected.
 * - Compact output: no insignificant whitespace anywhere.
 * - Rejected (throws {@link CanonicalJsonError} with the JSON path):
 *   `undefined` (anywhere), `bigint`, `symbol`, `function`, non-plain
 *   objects (`Date`, `Map`, `Set`, class instances, boxed primitives),
 *   and reference cycles.
 *
 * Repeated non-cyclic references (DAGs) are allowed and serialize once per
 * occurrence — JSON has no object identity, so this loses no information.
 */

import { sha256Hex } from '@clapp/core';

/** Thrown when a value cannot be represented in canonical JSON form. */
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

/** Canonical JSON serialization of `value` (see module doc for the rules). */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  return serializeValue(value, '$', seen);
}

/** UTF-8 encoding of the canonical JSON serialization of `value`. */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

/** sha256 (lowercase hex) of the canonical JSON bytes of `value`. */
export async function hashCanonicalJson(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

/** Non-throwing probe: can `value` be canonical-JSON serialized? */
export function isCanonicalJsonSafe(value: unknown): boolean {
  try {
    canonicalJson(value);
    return true;
  } catch {
    return false;
  }
}

function serializeValue(value: unknown, path: string, seen: Set<object>): string {
  switch (typeof value) {
    case 'undefined':
      throw new CanonicalJsonError(`${path}: undefined is not canonical-JSON serializable`);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value, path);
    case 'string':
      // ECMAScript well-formed stringify: stable escapes, lone surrogates
      // become \uXXXX — byte-identical across engines.
      return JSON.stringify(value);
    case 'bigint':
      throw new CanonicalJsonError(
        `${path}: bigint is not canonical-JSON serializable (convert to string first)`,
      );
    case 'symbol':
      throw new CanonicalJsonError(`${path}: symbol is not canonical-JSON serializable`);
    case 'function':
      throw new CanonicalJsonError(`${path}: function is not canonical-JSON serializable`);
    case 'object':
      if (value === null) return 'null';
      return serializeObject(value, path, seen);
  }
}

function serializeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError(`${path}: ${String(value)} is not canonical-JSON serializable (must be finite)`);
  }
  // Shortest round-trip form; -0 normalizes to "0".
  return JSON.stringify(value);
}

function serializeObject(value: object, path: string, seen: Set<object>): string {
  if (value === null) return 'null';

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new CanonicalJsonError(`${path}: reference cycle detected`);
    }
    seen.add(value);
    const items: string[] = [];
    // Index loop (not .map) so sparse-array holes surface as undefined
    // violations instead of silently vanishing.
    for (let index = 0; index < value.length; index += 1) {
      const item: unknown = value[index];
      items.push(serializeValue(item, `${path}[${index}]`, seen));
    }
    seen.delete(value);
    return `[${items.join(',')}]`;
  }

  if (!isPlainRecord(value)) {
    throw new CanonicalJsonError(
      `${path}: only plain objects and arrays are canonical-JSON serializable (observed ${describe(value)})`,
    );
  }
  if (seen.has(value)) {
    throw new CanonicalJsonError(`${path}: reference cycle detected`);
  }
  seen.add(value);
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item: unknown = record[key];
    if (item === undefined) {
      throw new CanonicalJsonError(`${path}.${key}: undefined value is not canonical-JSON serializable`);
    }
    parts.push(`${JSON.stringify(key)}:${serializeValue(item, `${path}.${key}`, seen)}`);
  }
  seen.delete(value);
  return `{${parts.join(',')}}`;
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describe(value: object): string {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Object]' ? 'a non-plain object' : tag;
}
