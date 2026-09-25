// CLAPP-020 — deterministic serialization: canonical text, round-trips,
// validation gates, and tmp-dir save/load with atomic writes.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IrModel } from './ir-contract';
import {
  IrPersistenceError,
  IrSerializationError,
  loadIrModel,
  parseIrModel,
  saveIrModel,
  serializeIrModel,
} from './serialize';
import { validateIrModel } from './validate';
import { buildReferenceModel, cloneModel } from './test-model';

/** Rebuild a value with every object's keys in reverse order (recursively). */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).reverse()) {
      out[key] = reverseKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

describe('serializeIrModel — canonical determinism', () => {
  test('serialize → parse → serialize is byte-identical', () => {
    const model = buildReferenceModel();
    const text = serializeIrModel(model);
    const parsed = parseIrModel(text);
    expect(serializeIrModel(parsed)).toBe(text);
  });

  test('key order is canonical regardless of insertion order', () => {
    const model = buildReferenceModel();
    const scrambled = reverseKeys(model) as IrModel;
    expect(serializeIrModel(scrambled)).toBe(serializeIrModel(model));
  });

  test('two structurally equal models serialize identically', () => {
    expect(serializeIrModel(buildReferenceModel())).toBe(serializeIrModel(cloneModel(buildReferenceModel())));
  });

  test('the canonical text is compact and object keys are sorted', () => {
    const text = serializeIrModel(buildReferenceModel());
    expect(text.startsWith('{"api":')).toBe(true); // first key alphabetically
    expect(text).not.toContain('\n');
    expect(text.endsWith('}')).toBe(true);
    expect(text).toContain('"modelVersion":"0.1"'); // no space around the colon
    expect(text).toContain('"screens":[');
  });

  test('serializing an INVALID model is refused with the path-qualified errors', () => {
    const model = buildReferenceModel();
    model.modelVersion = '9.9';
    expect(() => serializeIrModel(model)).toThrow(IrSerializationError);
    try {
      serializeIrModel(model);
    } catch (error) {
      expect((error as Error).message).toContain('modelVersion: expected "0.1", got "9.9"');
    }
  });

  test('serializing a cyclic model throws instead of hanging', () => {
    const model = buildReferenceModel();
    const screen = model.screens[0] as unknown as Record<string, unknown>;
    screen['self'] = model.screens[0];
    expect(() => serializeIrModel(model)).toThrow(/cycle/);
  });
});

describe('parseIrModel — single joined error', () => {
  test('valid canonical text parses to a validated model', () => {
    const model = parseIrModel(serializeIrModel(buildReferenceModel()));
    expect(validateIrModel(model)).toBe(true);
  });

  test('non-JSON text is rejected as such', () => {
    expect(() => parseIrModel('{nope')).toThrow(IrSerializationError);
    expect(() => parseIrModel('{nope')).toThrow(/not valid JSON/);
  });

  test('structurally invalid JSON throws ONE error joining the path-qualified violations', () => {
    let caught: unknown;
    try {
      parseIrModel('{"modelVersion":"0.1"}');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IrSerializationError);
    const message = (caught as Error).message;
    expect(message).toContain('application: expected a non-null object, got undefined');
    expect(message).toContain('evidence: expected an array, got undefined');
    expect(message).toContain('screens: expected an array, got undefined');
    expect(message.match(/\n/g)?.length).toBeGreaterThanOrEqual(1); // joined, multi-line
  });

  test('a scalar JSON document is rejected', () => {
    expect(() => parseIrModel('42')).toThrow(/not a valid IrModel/);
  });

  test('a model with one broken element names the exact path', () => {
    const model = buildReferenceModel();
    model.components[0]!.screenId = 'screen_missing';
    let caught: unknown;
    try {
      parseIrModel(JSON.stringify(model));
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toContain(
      'components[0].screenId: no screen with id "screen_missing" (declare the screen in screens first)',
    );
  });
});

describe('saveIrModel / loadIrModel — tmp-dir persistence', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'clapp-ir-serialize-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('save then load round-trips byte-identically', async () => {
    const model = buildReferenceModel();
    const path = join(dir, 'model.json');
    await saveIrModel(path, model);
    const loaded = await loadIrModel(path);
    expect(serializeIrModel(loaded)).toBe(serializeIrModel(model));
  });

  test('the file on disk is exactly the canonical serialization (UTF-8)', async () => {
    const model = buildReferenceModel();
    const path = join(dir, 'canonical.json');
    await saveIrModel(path, model);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(path, 'utf8')).toBe(serializeIrModel(model));
  });

  test('save creates parent directories as needed', async () => {
    const path = join(dir, 'deeply', 'nested', 'model.json');
    await saveIrModel(path, buildReferenceModel());
    expect((await loadIrModel(path)).modelVersion).toBe('0.1');
  });

  test('saving an invalid model refuses BEFORE touching the disk', async () => {
    const model = buildReferenceModel();
    model.constraints = [null as unknown as string];
    const path = join(dir, 'never-written.json');
    await expect(saveIrModel(path, model)).rejects.toThrow(IrSerializationError);
    await expect(loadIrModel(path)).rejects.toThrow(IrPersistenceError);
  });

  test('re-saving overwrites (models are living artifacts, not write-once)', async () => {
    const path = join(dir, 'living.json');
    const first = buildReferenceModel();
    await saveIrModel(path, first);
    const second = cloneModel(first);
    second.constraints = [...second.constraints, 'revised during repair'];
    await saveIrModel(path, second);
    const loaded = await loadIrModel(path);
    expect(loaded.constraints).toContain('revised during repair');
    expect(loaded.constraints).toHaveLength(3);
  });

  test('no temp files are left behind after saves', async () => {
    const path = join(dir, 'clean.json');
    await saveIrModel(path, buildReferenceModel());
    await saveIrModel(path, buildReferenceModel());
    const entries = await readdir(dir);
    expect(entries.filter((entry) => entry.includes('.tmp-'))).toEqual([]);
  });

  test('loading a missing file fails with a clear persistence error', async () => {
    await expect(loadIrModel(join(dir, 'does-not-exist.json'))).rejects.toThrow(IrPersistenceError);
  });

  test('loading a corrupt file fails with the serialization error', async () => {
    const path = join(dir, 'corrupt.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, '{corrupted', 'utf8');
    await expect(loadIrModel(path)).rejects.toThrow(/not valid JSON/);
  });

  test('an empty path is rejected', async () => {
    await expect(saveIrModel('', buildReferenceModel())).rejects.toThrow(IrPersistenceError);
  });

  test('a fresh directory receives the model without pre-existing structure', async () => {
    const nested = join(dir, `fresh-${Date.now()}`);
    await mkdir(nested, { recursive: true });
    const path = join(nested, 'model.json');
    await saveIrModel(path, buildReferenceModel());
    const entries = await readdir(nested);
    expect(entries).toEqual(['model.json']);
  });
});
