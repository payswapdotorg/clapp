// CLAPP-010 unit tests — runtime log channel (console/pageerror/browser-log).

import { describe, expect, test } from 'bun:test';
import {
  buildBrowserLogPayload,
  buildPageErrorPayload,
  reduceRuntimeLog,
  sanitizeConsoleArg,
  type RuntimeCapturePayload,
} from './runtime';

describe('sanitizeConsoleArg — canonical-safe conversion', () => {
  test('JSON-safe values pass through', () => {
    expect(sanitizeConsoleArg('text')).toBe('text');
    expect(sanitizeConsoleArg(42)).toBe(42);
    expect(sanitizeConsoleArg(true)).toBe(true);
    expect(sanitizeConsoleArg(null)).toBeNull();
  });

  test('non-finite numbers become their string spellings', () => {
    expect(sanitizeConsoleArg(Number.NaN)).toBe('NaN');
    expect(sanitizeConsoleArg(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(sanitizeConsoleArg(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
  });

  test('undefined → null, bigint/symbol/function → string forms', () => {
    expect(sanitizeConsoleArg(undefined)).toBeNull();
    expect(sanitizeConsoleArg(10n)).toBe('10');
    expect(sanitizeConsoleArg(Symbol('sym'))).toBe('Symbol(sym)');
    expect(sanitizeConsoleArg(function named() {})).toBe('[Function]');
  });

  test('Dates become ISO strings (or [Invalid Date])', () => {
    expect(sanitizeConsoleArg(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
    expect(sanitizeConsoleArg(new Date('nope'))).toBe('[Invalid Date]');
  });

  test('nested arrays and objects sanitize deeply', () => {
    const value = { list: [1, undefined, { deep: Number.NaN }] };
    expect(sanitizeConsoleArg(value)).toEqual({ list: [1, null, { deep: 'NaN' }] });
  });

  test('class instances become [unserializable]', () => {
    expect(sanitizeConsoleArg(new Map())).toBe('[unserializable]');
    expect(sanitizeConsoleArg(new (class Thing {})())).toBe('[unserializable]');
  });
});

describe('buildPageErrorPayload', () => {
  test('message + capped stack', () => {
    const payload = buildPageErrorPayload('boom', 'at x\n' + 'y'.repeat(5000));
    expect(payload.subkind).toBe('pageerror');
    expect(payload.message).toBe('boom');
    expect(payload.stack?.length).toBeLessThanOrEqual(4000);
  });

  test('absent stack stays absent (prune-friendly)', () => {
    expect(buildPageErrorPayload('boom', undefined).stack).toBeUndefined();
  });
});

describe('buildBrowserLogPayload — CDP Log.entryAdded narrowing', () => {
  test('well-formed entries convert', () => {
    const payload = buildBrowserLogPayload({
      entry: { source: 'network', level: 'error', text: 'ERR_FAILED', url: 'http://x/', lineNumber: 7 },
    });
    expect(payload).toEqual({ subkind: 'browser-log', source: 'network', level: 'error', text: 'ERR_FAILED', url: 'http://x/', line: 7 });
  });

  test('malformed events return null (never throw)', () => {
    expect(buildBrowserLogPayload(null)).toBeNull();
    expect(buildBrowserLogPayload({})).toBeNull();
    expect(buildBrowserLogPayload({ entry: { source: 1, level: 'error', text: 'x' } })).toBeNull();
  });
});

describe('reduceRuntimeLog', () => {
  test('counts by subkind and level', () => {
    const payloads: RuntimeCapturePayload[] = [
      { subkind: 'console', level: 'log', text: 'a' },
      { subkind: 'console', level: 'log', text: 'b' },
      { subkind: 'console', level: 'error', text: 'c' },
      { subkind: 'pageerror', message: 'x' },
      { subkind: 'browser-log', source: 'network', level: 'error', text: 'y' },
    ];
    const summary = reduceRuntimeLog(payloads);
    expect(summary.total).toBe(5);
    expect(summary.consoleRecords).toBe(3);
    expect(summary.pageErrors).toBe(1);
    expect(summary.browserLogs).toBe(1);
    expect(summary.byLevel['log']).toBe(2);
    expect(summary.errorLevelCount).toBe(1); // console error only; assert counts too
  });

  test('empty input is all zeros', () => {
    expect(reduceRuntimeLog([])).toEqual({
      total: 0,
      consoleRecords: 0,
      pageErrors: 0,
      browserLogs: 0,
      errorLevelCount: 0,
      byLevel: {},
    });
  });
});
