// canonicalJson — the byte-level ground truth for every evidence hash.

import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '@clapp/core';
import {
  CanonicalJsonError,
  canonicalJson,
  canonicalJsonBytes,
  hashCanonicalJson,
  isCanonicalJsonSafe,
} from './canonical-json';

describe('canonicalJson', () => {
  test('sorts object keys at every level, compactly (no whitespace)', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  test('key insertion order does not matter', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  test('arrays preserve element order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  test('primitives serialize compactly', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(0)).toBe('0');
    expect(canonicalJson(-12)).toBe('-12');
  });

  test('-0 normalizes to 0; floats use the shortest round-trip form', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(0.5)).toBe('0.5');
    expect(canonicalJson(1e21)).toBe('1e+21');
  });

  test('string escaping is stable and well-formed', () => {
    expect(canonicalJson('a"b\\c\nd\te')).toBe('"a\\"b\\\\c\\nd\\te"');
    expect(canonicalJson('\u0001')).toBe('"\\u0001"');
    // lone surrogate is escaped (well-formed stringify), not emitted raw
    expect(canonicalJson('\ud800')).toBe('"\\ud800"');
    // non-ASCII characters pass through verbatim
    expect(canonicalJson('é😀')).toBe('"é😀"');
  });

  test('object keys sort in UTF-16 code-unit order (incl. non-ASCII)', () => {
    expect(canonicalJson({ z: 1, a: 2, é: 3 })).toBe('{"a":2,"z":1,"é":3}');
  });

  test('empty containers serialize to their minimal forms', () => {
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
  });

  test('round-trips: JSON.parse(canonicalJson(x)) deep-equals x for plain values', () => {
    const value = { a: [1, 'two', { three: null }], b: false, unicode: 'é😀' };
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });

  test('rejects undefined (top level, object values, array items, sparse holes)', () => {
    expect(() => canonicalJson(undefined)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ a: undefined })).toThrow(/undefined/);
    expect(() => canonicalJson([undefined])).toThrow(/undefined/);
    const sparse: unknown[] = new Array(1); // one hole, no elements
    expect(() => canonicalJson(sparse)).toThrow(/undefined/);
  });

  test('rejects NaN and Infinity with the path in the message', () => {
    expect(() => canonicalJson({ ok: 1, bad: { deep: [0, Number.NaN] } })).toThrow(
      /\$\.bad\.deep\[1\].*NaN|NaN.*\$\.bad\.deep\[1\]/,
    );
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(CanonicalJsonError);
  });

  test('rejects bigint, symbol and function values', () => {
    expect(() => canonicalJson(1n)).toThrow(/bigint/);
    expect(() => canonicalJson(Symbol('x'))).toThrow(/symbol/);
    expect(() => canonicalJson(() => 1)).toThrow(/function/);
  });

  test('rejects non-plain objects (Date, Map, Set, class instances)', () => {
    expect(() => canonicalJson(new Date(0))).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(new Map())).toThrow(/plain/);
    expect(() => canonicalJson(new Set())).toThrow(/plain/);
    class Fixture {
      x = 1;
    }
    expect(() => canonicalJson(new Fixture())).toThrow(/plain/);
  });

  test('Object.create(null) records are plain and serialize', () => {
    const nullProto = Object.create(null);
    nullProto['b'] = 2;
    nullProto['a'] = 1;
    expect(canonicalJson(nullProto)).toBe('{"a":1,"b":2}');
  });

  test('rejects cycles with the offending path in the message', () => {
    const value: Record<string, unknown> = {};
    value['self'] = value;
    expect(() => canonicalJson(value)).toThrow(/\$\.self/);
  });

  test('repeated non-cyclic references serialize per occurrence (DAGs allowed)', () => {
    const shared = { s: 1 };
    expect(canonicalJson({ x: shared, y: shared })).toBe('{"x":{"s":1},"y":{"s":1}}');
  });

  test('error messages carry JSON paths for nested violations', () => {
    expect(() => canonicalJson({ ok: 1, bad: { arr: [1, 2, { nope: new Map() }] } })).toThrow(
      /\$\.bad\.arr\[2\]\.nope/,
    );
  });

  test('canonicalJsonBytes is the UTF-8 encoding of canonicalJson', () => {
    const value = { é: '😀' };
    const expected = new TextEncoder().encode(canonicalJson(value));
    expect(canonicalJsonBytes(value)).toEqual(expected);
  });

  test('hashCanonicalJson is sha256 over the canonical bytes', async () => {
    const value = { b: 2, a: 1 };
    const manual = await sha256Hex(new TextEncoder().encode(canonicalJson(value)));
    expect(await hashCanonicalJson(value)).toBe(manual);
  });

  test('isCanonicalJsonSafe probes without throwing', () => {
    expect(isCanonicalJsonSafe({ a: 1 })).toBe(true);
    expect(isCanonicalJsonSafe(new Date())).toBe(false);
    expect(isCanonicalJsonSafe({ bad: () => 1 })).toBe(false);
  });
});
