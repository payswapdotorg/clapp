// CLAPP-020 — canonical JSON serializer: golden strings, determinism, and
// every rejection class. Semantics intentionally mirror the platform
// convention (sorted keys, stable escapes, compact, order-preserving
// arrays, finite numbers only) — implemented independently here so
// @clapp/ir never depends on @clapp/evidence.

import { describe, expect, test } from 'bun:test';
import { CanonicalJsonError, canonicalJson, canonicalJsonBytes, isCanonicalJsonSafe } from './canonical-json';

describe('canonical-json — golden output', () => {
  test('object keys are sorted, recursively', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ z: { c: 1, a: 2 }, a: [{ b: 1, a: 1 }] })).toBe('{"a":[{"a":1,"b":1}],"z":{"a":2,"c":1}}');
  });

  test('sort is UTF-16 code-unit order, not locale order', () => {
    expect(canonicalJson({ a: 1, b: 2, B: 3 })).toBe('{"B":3,"a":1,"b":2}');
  });

  test('array element order is preserved', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([{ b: 1, a: 2 }, 0, 'x'])).toBe('[{"a":2,"b":1},0,"x"]');
  });

  test('output is compact (no insignificant whitespace)', () => {
    expect(canonicalJson({ a: [1, 2], b: { c: true } })).toBe('{"a":[1,2],"b":{"c":true}}');
  });

  test('string escaping matches JSON.stringify exactly', () => {
    for (const value of ['he"llo', 'back\\slash', 'new\nline', 'tab\t', 'ctl\x01', 'héllo', '😀'.slice(0, 1) + 'x']) {
      expect(canonicalJson(value)).toBe(JSON.stringify(value));
    }
  });

  test('lone surrogates escape as \\uXXXX (well-formed JSON)', () => {
    expect(canonicalJson('\uD800')).toBe('"\\ud800"');
    expect(canonicalJson({ '\uD800': 1 })).toBe('{"\\ud800":1}');
  });

  test('numbers use the shortest round-trip form; -0 normalizes to 0', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(0.5)).toBe('0.5');
    expect(canonicalJson(1e21)).toBe(JSON.stringify(1e21));
    expect(canonicalJson(9007199254740991)).toBe('9007199254740991'); // 2^53 - 1, exactly representable
  });

  test('booleans and null serialize plainly', () => {
    expect(canonicalJson([true, false, null])).toBe('[true,false,null]');
  });

  test('objects with null prototype are plain records', () => {
    const record = Object.create(null) as Record<string, unknown>;
    record['b'] = 1;
    record['a'] = 2;
    expect(canonicalJson(record)).toBe('{"a":2,"b":1}');
  });

  test('repeated non-cyclic references (DAGs) serialize per occurrence', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  test('empty containers', () => {
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
  });
});

describe('canonical-json — rejections', () => {
  test('undefined anywhere', () => {
    expect(() => canonicalJson(undefined)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ a: undefined })).toThrow(/undefined/);
    expect(() => canonicalJson([undefined])).toThrow(/undefined/);
    // sparse-array holes surface as undefined violations
    const sparse: unknown[] = [];
    sparse[2] = 'x';
    expect(() => canonicalJson(sparse)).toThrow(/undefined/);
  });

  test('non-finite numbers', () => {
    expect(() => canonicalJson(NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(Infinity)).toThrow(/Infinity/);
    expect(() => canonicalJson(-Infinity)).toThrow(/-Infinity/);
    expect(() => canonicalJson({ a: [1, Number.NaN] })).toThrow(/NaN/);
  });

  test('bigint, symbol, function', () => {
    expect(() => canonicalJson(10n)).toThrow(/bigint/);
    expect(() => canonicalJson(Symbol('x'))).toThrow(/symbol/);
    expect(() => canonicalJson(() => 1)).toThrow(/function/);
  });

  test('non-plain objects', () => {
    expect(() => canonicalJson(new Date(0))).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(new Date(0))).toThrow(/\[object Date\]/);
    expect(() => canonicalJson(new Map())).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(new Set())).toThrow(CanonicalJsonError);
    class Box {
      constructor(public value: number) {}
    }
    expect(() => canonicalJson(new Box(1))).toThrow(/non-plain object/);
  });

  test('reference cycles (objects and arrays) report the path', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cycle/);
    const arr: unknown[] = [1];
    arr.push(arr);
    expect(() => canonicalJson(arr)).toThrow(/cycle/);
  });
});

describe('canonical-json — helpers', () => {
  test('isCanonicalJsonSafe probes without throwing', () => {
    expect(isCanonicalJsonSafe({ a: [1, 'x'] })).toBe(true);
    expect(isCanonicalJsonSafe(undefined)).toBe(false);
    expect(isCanonicalJsonSafe(Infinity)).toBe(false);
    expect(isCanonicalJsonSafe(() => 1)).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(isCanonicalJsonSafe(cyclic)).toBe(false);
  });

  test('canonicalJsonBytes is the UTF-8 encoding', () => {
    const bytes = canonicalJsonBytes({ b: 1, a: 'é' });
    expect(bytes).toEqual(new TextEncoder().encode('{"a":"é","b":1}'));
  });

  test('serialization is deterministic across insertion orders', () => {
    const first = { route: '/a', id: 1, events: ['click'] };
    const second = { events: ['click'], id: 1, route: '/a' };
    expect(canonicalJson(first)).toBe(canonicalJson(second));
  });
});
