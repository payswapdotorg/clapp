// CLAPP-020 — the canonical ir-contract module: runtime surface is exactly
// IR_MODEL_VERSION (everything else is types), and the version matches the
// v0.1 declaration.

import { describe, expect, test } from 'bun:test';
import * as contract from './ir-contract';
import { IR_MODEL_VERSION } from './ir-contract';

describe('ir-contract (canonical owner: @clapp/ir)', () => {
  test('IR_MODEL_VERSION is "0.1"', () => {
    expect(IR_MODEL_VERSION).toBe('0.1');
  });

  test('the module is types-only besides IR_MODEL_VERSION (no hidden runtime surface)', () => {
    expect(Object.keys(contract).sort()).toEqual(['IR_MODEL_VERSION']);
  });

  test('IR_MODEL_VERSION is a plain string primitive (not a String object)', () => {
    expect(typeof IR_MODEL_VERSION).toBe('string');
  });
});
