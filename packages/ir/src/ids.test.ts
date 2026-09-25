// CLAPP-020 — identifier helpers: prefix patterns, uuid v4 minting,
// uniqueness, and the deliberate absence of journey-id minting.

import { describe, expect, test } from 'bun:test';
import * as ir from './index';
import {
  API_OPERATION_ID_PATTERN,
  APPLICATION_ID_PATTERN,
  ASSUMPTION_ID_PATTERN,
  COMPONENT_ID_PATTERN,
  DATA_ENTITY_ID_PATTERN,
  EVIDENCE_ENTRY_ID_PATTERN,
  INTEGRATION_ID_PATTERN,
  IR_ID_PREFIXES,
  JOURNEY_ID_PATTERN,
  SCREEN_ID_PATTERN,
  STATE_VARIABLE_ID_PATTERN,
  TRANSITION_ID_PATTERN,
  UUID_SHAPE_RE,
  irIdPatternFor,
  mintIrId,
  newApiOperationId,
  newApplicationId,
  newAssumptionId,
  newComponentId,
  newDataEntityId,
  newEvidenceEntryId,
  newIntegrationId,
  newScreenId,
  newStateVariableId,
  newTransitionId,
} from './ids';

const ALL_PATTERNS: ReadonlyArray<[string, RegExp, () => string]> = [
  ['app_', APPLICATION_ID_PATTERN, newApplicationId],
  ['irev_', EVIDENCE_ENTRY_ID_PATTERN, newEvidenceEntryId],
  ['screen_', SCREEN_ID_PATTERN, newScreenId],
  ['comp_', COMPONENT_ID_PATTERN, newComponentId],
  ['var_', STATE_VARIABLE_ID_PATTERN, newStateVariableId],
  ['trans_', TRANSITION_ID_PATTERN, newTransitionId],
  ['ent_', DATA_ENTITY_ID_PATTERN, newDataEntityId],
  ['op_', API_OPERATION_ID_PATTERN, newApiOperationId],
  ['integ_', INTEGRATION_ID_PATTERN, newIntegrationId],
  ['assume_', ASSUMPTION_ID_PATTERN, newAssumptionId],
];

describe('ids — minters', () => {
  test.each(ALL_PATTERNS)('%s-prefixed ids match the pattern and are unique', (prefix, pattern, mint) => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const id = mint();
      expect(id.startsWith(prefix)).toBe(true);
      expect(pattern.test(id)).toBe(true);
      expect(UUID_SHAPE_RE.test(id.slice(prefix.length))).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(200);
  });

  test('minted ids are true uuid v4 (version nibble 4, variant nibble 8-b)', () => {
    for (let index = 0; index < 50; index += 1) {
      const uuid = newScreenId().slice('screen_'.length);
      expect(uuid[14]).toBe('4');
      expect('89ab'.includes(uuid[19] ?? '')).toBe(true);
    }
  });

  test('mintIrId mints any prefix', () => {
    expect(mintIrId('x_').startsWith('x_')).toBe(true);
    expect(mintIrId('x_').length).toBe('x_'.length + 36);
  });
});

describe('ids — patterns', () => {
  test('accept their own prefix + uuid-shaped hex (case-insensitive hex)', () => {
    expect(SCREEN_ID_PATTERN.test('screen_10000000-0000-4000-8000-000000000001')).toBe(true);
    expect(SCREEN_ID_PATTERN.test('screen_ABCDEF12-0000-4000-8000-00000000000A')).toBe(true);
  });

  test('reject wrong prefix, bad shape, and non-strings', () => {
    expect(SCREEN_ID_PATTERN.test('comp_10000000-0000-4000-8000-000000000001')).toBe(false);
    // NOTE: the /i flag follows the frozen JOURNEY_ID_PATTERN convention, so
    // the PREFIX itself matches case-insensitively too ('Screen_' matches);
    // our minters always emit lowercase, and foreign tools matching the
    // pattern are harmless. Wrong prefixes still fail:
    expect(SCREEN_ID_PATTERN.test('Screen_10000000-0000-4000-8000-000000000001')).toBe(true);
    expect(SCREEN_ID_PATTERN.test('xcreen_10000000-0000-4000-8000-000000000001')).toBe(false);
    expect(SCREEN_ID_PATTERN.test('screen_not-a-uuid')).toBe(false);
    expect(SCREEN_ID_PATTERN.test('screen_10000000-0000-4000-8000-0000000000')).toBe(false);
    expect(SCREEN_ID_PATTERN.test('')).toBe(false);
  });

  test('journey ids use the same shape as @clapp/journey (id minting stays there)', () => {
    expect(JOURNEY_ID_PATTERN.test('journey_5bee1e16-86b8-4447-8c9e-26ee583a341a')).toBe(true);
    expect(JOURNEY_ID_PATTERN.test('journey_bad')).toBe(false);
    // The IR package deliberately exposes NO journey-id minter.
    expect((ir as unknown as Record<string, unknown>)['newJourneyId']).toBeUndefined();
  });

  test('irIdPatternFor maps declared prefixes to patterns', () => {
    expect(irIdPatternFor(IR_ID_PREFIXES.screen)).toBe(SCREEN_ID_PATTERN);
    expect(irIdPatternFor(IR_ID_PREFIXES.apiOperation)).toBe(API_OPERATION_ID_PATTERN);
    expect(irIdPatternFor(IR_ID_PREFIXES.assumption)).toBe(ASSUMPTION_ID_PATTERN);
    expect(irIdPatternFor('nope_')).toBeUndefined();
  });

  test('IR_ID_PREFIXES covers every declared element kind', () => {
    const declared: readonly string[] = Object.values(IR_ID_PREFIXES);
    expect([...declared].sort()).toEqual(
      [
        'app_', 'assume_', 'comp_', 'ent_', 'integ_', 'irev_', 'journey_',
        'op_', 'screen_', 'trans_', 'var_',
      ].sort(),
    );
  });
});
