/**
 * Canonical JSON serialization for @clapp/ir — the byte-level ground truth
 * for `serializeIrModel` and for element comparison inside `diffIrModels`.
 *
 * This is @clapp/ir's OWN implementation, deliberately NOT imported from
 * @clapp/evidence: the Behavioral IR is framework-independent by design
 * (docs/BEHAVIORAL_IR.md §1 principles 5/6) and EvidenceRef from @clapp/core
 * is the only evidence type it needs. The semantics are the same ones the
 * whole platform already standardized on:
 *
 * - Objects: plain records only (prototype `Object.prototype` or `null`);
 *   keys serialized in UTF-16 code-unit order (`Array#sort()` default),
 *   recursively — insertion order never leaks into the output.
 * - Arrays: element order PRESERVED (order is semantic; see diff.ts for
 *   which arrays additionally carry set semantics at comparison time).
 * - Strings: the ECMAScript well-formed JSON escaping (exactly what
 *   `JSON.stringify` produces for a string — `\"`, `\\`, standard control
 *   escapes, `\uXXXX` for other control characters and lone surrogates;
 *   non-ASCII characters are emitted verbatim).
 * - Numbers: finite values only, shortest round-trip form (`-0` becomes
 *   `0`); `NaN` / `Infinity` / `-Infinity` are rejected.
 * - Compact output: no insignificant whitespace anywhere.
 * - Rejected (throws {@link CanonicalJsonError} carrying the JSON path):
 *   `undefined` (anywhere), `bigint`, `symbol`, `function`, and non-plain
 *   objects (`Date`, `Map`, `Set`, class instances, boxed primitives), plus
 *   reference cycles. Repeated non-cyclic references (DAGs) are allowed and
 *   serialize once per occurrence — JSON has no object identity, so this
 *   loses no information.
 */

/** Thrown when a value cannot be represented in canonical JSON form. */
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

/** Canonical JSON serialization of `value` (see module doc for the rules). */
export function canonicalJson(value: unknown): string {
  const inProgress: object[] = [];
  return write(value, '$', inProgress);
}

/** UTF-8 bytes of the canonical JSON serialization of `value`. */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
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

function write(value: unknown, path: string, inProgress: object[]): string {
  switch (typeof value) {
    case 'undefined':
      throw new CanonicalJsonError(`${path}: undefined is not canonical-JSON serializable`);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return writeNumber(value, path);
    case 'string':
      // JSON.stringify on a string is the engine-stable well-formed escape:
      // byte-identical across engines, lone surrogates become \uXXXX.
      return JSON.stringify(value);
    case 'bigint':
      throw new CanonicalJsonError(`${path}: bigint is not canonical-JSON serializable (convert to string first)`);
    case 'symbol':
      throw new CanonicalJsonError(`${path}: symbol is not canonical-JSON serializable`);
    case 'function':
      throw new CanonicalJsonError(`${path}: function is not canonical-JSON serializable`);
    case 'object':
      if (value === null) return 'null';
      return writeObject(value, path, inProgress);
  }
}

function writeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError(
      `${path}: ${String(value)} is not canonical-JSON serializable (must be finite)`,
    );
  }
  // Shortest round-trip form; JSON.stringify('-0') is "0".
  return JSON.stringify(value);
}

function writeObject(value: object, path: string, inProgress: object[]): string {
  if (Array.isArray(value)) {
    if (inProgress.includes(value)) {
      throw new CanonicalJsonError(`${path}: reference cycle detected`);
    }
    inProgress.push(value);
    const parts: string[] = [];
    // Index loop (not .map) so sparse-array holes surface as undefined
    // violations instead of silently vanishing.
    for (let index = 0; index < value.length; index += 1) {
      parts.push(write(value[index], `${path}[${index}]`, inProgress));
    }
    inProgress.pop();
    return `[${parts.join(',')}]`;
  }

  if (!isPlainRecord(value)) {
    throw new CanonicalJsonError(
      `${path}: only plain objects and arrays are canonical-JSON serializable (observed ${describe(value)})`,
    );
  }
  if (inProgress.includes(value)) {
    throw new CanonicalJsonError(`${path}: reference cycle detected`);
  }
  inProgress.push(value);
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  // Default sort = UTF-16 code-unit order; canonical regardless of the
  // order keys were inserted in.
  for (const key of Object.keys(record).sort()) {
    const item: unknown = record[key];
    if (item === undefined) {
      throw new CanonicalJsonError(`${path}.${key}: undefined value is not canonical-JSON serializable`);
    }
    parts.push(`${JSON.stringify(key)}:${write(item, `${path}.${key}`, inProgress)}`);
  }
  inProgress.pop();
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
