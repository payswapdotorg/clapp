/**
 * @clapp/extract — compact structural schema sketches (api-extractor v0).
 *
 * A sketch is a coarse { type, keys, valueTypes } descriptor derived from a
 * JSON-parsable body (postData / bodyPreview / ws frame payload):
 *
 *   { "email": "a@b.c", "count": 3 }
 *     → { type: 'object', keys: ['count', 'email'], valueTypes: { count: 'number', email: 'string' } }
 *
 * - object → type 'object' + sorted keys + coarse value types;
 * - array / scalar / null → type only (arrays: 'array'; scalars: their typeof;
 *   null: 'null') — the work item freezes the sketch vocabulary at exactly
 *   {type, keys, valueTypes};
 * - non-JSON text → { ok: false, reason } with 'truncated' when the honest
 *   observe truncation marker is present ("…[truncated N chars]") and
 *   'invalid' otherwise — the caller turns these into absent schema +
 *   warning + assumption;
 * - absent/empty text → { ok: false, reason: 'empty' } — a request with no
 *   body legitimately has NO schema, which is NOT a degradation.
 */

export interface ShapeSketch {
  type: string;
  keys?: string[];
  valueTypes?: Record<string, string>;
}

export type SketchOutcome =
  | { ok: true; sketch: ShapeSketch }
  | { ok: false; reason: 'empty' | 'truncated' | 'invalid' };

/** The truncation marker @clapp/observe's truncateText appends. */
export const TRUNCATION_MARKER = '[truncated ';

function coarseType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

export function sketchJsonText(text: string | undefined): SketchOutcome {
  if (text === undefined || text === '') {
    return { ok: false, reason: 'empty' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: text.includes(TRUNCATION_MARKER) ? 'truncated' : 'invalid' };
  }
  if (Array.isArray(value)) {
    return { ok: true, sketch: { type: 'array' } };
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const valueTypes: Record<string, string> = {};
    for (const key of keys) {
      valueTypes[key] = coarseType(record[key]);
    }
    return { ok: true, sketch: { type: 'object', keys, valueTypes } };
  }
  return { ok: true, sketch: { type: coarseType(value) } };
}
