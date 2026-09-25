// CLAPP-021 unit — storage extractor: entities, state variables, honest
// unknowns for redacted/truncated values, first-appearance dedupe.

import { describe, expect, test } from 'bun:test';
import { SynthClock, extractFromSynth, storageInventoryCapture, synthBundle } from './test-utils';

const clock = new SynthClock();

describe('storage-extractor — localStorage/sessionStorage', () => {
  test('JSON object value → entity with per-key fields and provenance', async () => {
    const synth = await synthBundle([
      storageInventoryCapture(clock.next(), {
        localStorage: [{ key: 'cart', valuePreview: '{"itemCount":2,"coupon":"SAVE"}' }],
      }),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.data.entities.length).toBe(1);
    const entity = model.data.entities[0]!;
    expect(entity.name).toBe('cart');
    expect(entity.persistence).toEqual(['localStorage:cart']);
    expect(entity.fields.map((field) => [field.name, field.domain])).toEqual([['coupon', 'text'], ['itemCount', 'count']]);
    expect(entity.fields.every((field) => field.provenance.level === 'derived')).toBe(true);
    expect(entity.fields.every((field) => field.provenance.confidence.evidenceRefs.length === 1)).toBe(true);
  });

  test('JSON scalar value → entity value field + IrStateVariable with mapped domain', async () => {
    const synth = await synthBundle([
      storageInventoryCapture(clock.next(), {
        localStorage: [{ key: 'theme', valuePreview: '"dark"' }],
        sessionStorage: [{ key: 'visits', valuePreview: '7' }],
      }),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.data.entities.map((entity) => entity.persistence[0])).toEqual(['localStorage:theme', 'sessionStorage:visits']);
    expect(model.data.entities[0]!.fields.map((field) => [field.name, field.domain])).toEqual([['value', 'text']]);
    expect(model.state.variables.map((variable) => [variable.name, variable.domain])).toEqual([
      ['localStorage:theme', 'text'],
      ['sessionStorage:visits', 'count'],
    ]);
    expect(model.state.variables.every((variable) => variable.provenance.level === 'derived')).toBe(true);
  });

  test('non-JSON (redacted/truncated) value → unknown domain + assumption, never an invented field', async () => {
    const synth = await synthBundle([
      storageInventoryCapture(clock.next(), {
        localStorage: [{ key: 'session-token', valuePreview: '[REDACTED]' }],
      }),
    ]);
    const { model } = await extractFromSynth(synth);
    const entity = model.data.entities[0]!;
    expect(entity.name).toBe('session-token');
    expect(entity.fields.map((field) => [field.name, field.domain])).toEqual([['value', 'unknown']]);
    expect(entity.fields[0]!.provenance.level).toBe('unavailable');
    const variable = model.state.variables[0]!;
    expect(variable.domain).toBe('unknown');
    expect(variable.provenance.level).toBe('unavailable');
    expect(model.assumptions.length).toBe(1);
    expect(model.assumptions[0]!.statement).toContain('localStorage:session-token');
    expect(model.assumptions[0]!.provenance.confidence.value).toBeLessThanOrEqual(0.5);
    expect(JSON.stringify(model).includes('[REDACTED]')).toBe(false); // preview text never enters the model
  });

  test('cookie → entity with persistence cookie:<name>; redacted value stays unknown', async () => {
    const synth = await synthBundle([
      storageInventoryCapture(clock.next(), {
        cookies: [{ name: 'sessionid', value: '[REDACTED]' }],
      }),
    ]);
    const { model } = await extractFromSynth(synth);
    const entity = model.data.entities[0]!;
    expect(entity.name).toBe('sessionid');
    expect(entity.persistence).toEqual(['cookie:sessionid']);
    expect(entity.fields[0]!.domain).toBe('unknown');
    expect(model.state.variables.length).toBe(0); // redacted cookie values never become claimed state
    expect(model.assumptions.length).toBe(1);
  });

  test('indexedDB database → entity with object-store fields (unknown record shape)', async () => {
    const synth = await synthBundle([
      storageInventoryCapture(clock.next(), {
        indexedDB: [{ name: 'notes', objectStores: ['notes', 'meta'], version: 2 }],
      }),
    ]);
    const { model } = await extractFromSynth(synth);
    const entity = model.data.entities[0]!;
    expect(entity.name).toBe('notes');
    expect(entity.persistence).toEqual(['indexeddb:notes']);
    expect(entity.fields.map((field) => field.name)).toEqual(['notes', 'meta', 'version']);
    expect(entity.fields.find((field) => field.name === 'version')!.domain).toBe('count');
    expect(entity.fields.find((field) => field.name === 'notes')!.domain).toBe('unknown');
  });

  test('repeated keys across inventories: first appearance wins; later-only keys appear then', async () => {
    const synth = await synthBundle([
      storageInventoryCapture(clock.next(), {
        localStorage: [{ key: 'theme', valuePreview: '"dark"' }],
      }),
      storageInventoryCapture(clock.next(), {
        localStorage: [
          { key: 'theme', valuePreview: '"light"' }, // value changed later — first observation stands
          { key: 'flag', valuePreview: 'true' },
        ],
      }),
    ]);
    const { model } = await extractFromSynth(synth);
    expect(model.data.entities.map((entity) => entity.name).sort()).toEqual(['flag', 'theme']);
    const theme = model.data.entities.find((entity) => entity.name === 'theme')!;
    expect(theme.fields[0]!.domain).toBe('text'); // derived from the FIRST observation ("dark")
    expect(model.state.variables.find((variable) => variable.name === 'localStorage:theme')!.domain).toBe('text');
    expect(model.data.entities.length).toBe(2); // no duplicate theme entity
  });
});
