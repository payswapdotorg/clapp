// CLAPP-010 unit tests — canonical JSON serialization.

import { describe, expect, test } from 'bun:test';
import { canonicalJson, canonicalJsonBytes, isCanonicalSerializable, isPlainObject, pruneUndefined } from './canonical-json';

describe('canonicalJson — determinism', () => {
  test('key order is irrelevant: same value, same bytes', () => {
    const a = { z: 1, a: { y: [1, 2], b: true }, m: 'x' };
    const b = { m: 'x', a: { b: true, y: [1, 2] }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  test('nested keys sort recursively and output is stable across calls', () => {
    const value = { b: { d: 1, c: 2 }, a: [{ z: 1, y: 2 }] };
    const first = canonicalJson(value);
    const second = canonicalJson(value);
    expect(first).toBe(second);
    expect(first).toBe('{"a":[{"y":2,"z":1}],"b":{"c":2,"d":1}}');
  });

  test('round-trips through JSON.parse for plain data', () => {
    const value = { n: -0.5, s: 'quote " backslash \\ newline \n ctrl \u0001', arr: [null, true, false, 0], unicode: 'héllo ✓' };
    const text = canonicalJson(value);
    expect(JSON.parse(text)).toEqual(value);
    expect(canonicalJson(JSON.parse(text))).toBe(text);
  });

  test('empty object and array are distinguishable', () => {
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
  });
});

describe('canonicalJson — rejection of non-canonical values', () => {
  test('undefined throws', () => {
    expect(() => canonicalJson(undefined)).toThrow();
  });

  test('non-finite numbers throw (NaN, Infinity)', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });

  test('class instances, Dates, Maps throw', () => {
    expect(() => canonicalJson(new Date(0))).toThrow(/not canonical-JSON serializable/);
    expect(() => canonicalJson(new Map())).toThrow();
    expect(() => canonicalJson(new Uint8Array([1]))).toThrow();
  });

  test('functions and symbols throw', () => {
    expect(() => canonicalJson(() => 1)).toThrow();
    expect(() => canonicalJson(Symbol('x'))).toThrow();
  });

  test('deep nesting beyond the cap throws with a path', () => {
    let deep: unknown = { leaf: true };
    for (let i = 0; i < 200; i++) deep = { wrapped: deep };
    expect(() => canonicalJson(deep)).toThrow(/nesting/);
  });
});

describe('isCanonicalSerializable — total check', () => {
  test('accepts plain JSON data', () => {
    expect(isCanonicalSerializable(null)).toBe(true);
    expect(isCanonicalSerializable({ a: [1, 'x', false] })).toBe(true);
  });

  test('rejects non-canonical values without throwing', () => {
    expect(isCanonicalSerializable(undefined)).toBe(false);
    expect(isCanonicalSerializable(Number.NaN)).toBe(false);
    expect(isCanonicalSerializable({ bad: new Date() })).toBe(false);
  });
});

describe('canonicalJsonBytes — byte accounting', () => {
  test('byteLength matches UTF-8 encoding of the text', () => {
    const { text, byteLength } = canonicalJsonBytes({ msg: 'héllo ✓' });
    expect(byteLength).toBe(new TextEncoder().encode(text).byteLength);
    expect(byteLength).toBeGreaterThan(text.length); // multi-byte chars
  });
});

describe('pruneUndefined', () => {
  test('drops undefined-valued keys deeply', () => {
    const input = { a: 1, b: undefined, c: { d: undefined, e: 2 } };
    expect(pruneUndefined(input)).toEqual({ a: 1, c: { e: 2 } });
  });

  test('array undefined elements become null (positions preserved)', () => {
    expect(pruneUndefined([1, undefined, 3])).toEqual([1, null, 3]);
  });

  test('top-level undefined becomes null', () => {
    expect(pruneUndefined(undefined)).toBeNull();
  });

  test('pruned payloads are canonicalizable even when built with undefined', () => {
    const messy = { url: 'http://x/', line: undefined, column: undefined };
    expect(() => canonicalJson(pruneUndefined(messy))).not.toThrow();
    expect(canonicalJson(pruneUndefined(messy))).toBe('{"url":"http://x/"}');
  });
});

describe('isPlainObject', () => {
  test('plain object literals and null-prototype objects pass', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  test('arrays, null, primitives, class instances fail', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });
});
