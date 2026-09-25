// CLAPP-020 — adapter honesty summaries: verbatim echoing of unsupported
// constructs and degradation behavior, the current-version NOTE, and
// rejection of malformed declarations.

import { describe, expect, test } from 'bun:test';
import { IrAdapterError, describeIrAdapter } from './adapter';
import type { IrAdapterInfo } from './ir-contract';

const FULL: IrAdapterInfo = {
  adapterId: 'clapp-extract-web-v0',
  supportedModelVersions: ['0.1'],
  emittedCapabilities: ['evidence', 'screens', 'components', 'api.operations'],
  unsupportedConstructs: [
    'IrTransitionTrigger "websocket-message" (never observed in the web adapter)',
    'IrDataEntity persistence beyond localStorage (session/cookies unmodeled)',
  ],
  degradationBehavior: 'skips the construct, records an IrAssumption, and notes the skip in the run log',
};

describe('describeIrAdapter — honesty contract', () => {
  test('renders id, versions, capabilities, and degradation verbatim', () => {
    const summary = describeIrAdapter(FULL);
    expect(summary).toContain('IR adapter clapp-extract-web-v0');
    expect(summary).toContain('supported model versions: 0.1');
    expect(summary).toContain('evidence, screens, components, api.operations');
    expect(summary).toContain(
      'degradation behavior: skips the construct, records an IrAssumption, and notes the skip in the run log',
    );
  });

  test('every unsupported construct is echoed VERBATIM', () => {
    const summary = describeIrAdapter(FULL);
    for (const construct of FULL.unsupportedConstructs) {
      expect(summary).toContain(construct);
    }
    expect(summary).toContain('unsupported constructs (2, verbatim):');
  });

  test('no version NOTE when the current IR_MODEL_VERSION is declared', () => {
    expect(describeIrAdapter(FULL)).not.toContain('NOTE');
  });

  test('explicit NOTE when the current model version is NOT declared', () => {
    const summary = describeIrAdapter({
      ...FULL,
      supportedModelVersions: ['0.2', '0.3'],
    });
    expect(summary).toContain('NOTE: this adapter does not declare support for IR model version 0.1');
  });

  test('empty arrays render "(none)" (and still carry the version NOTE)', () => {
    const summary = describeIrAdapter({
      adapterId: 'bare',
      supportedModelVersions: [],
      emittedCapabilities: [],
      unsupportedConstructs: [],
      degradationBehavior: 'nothing to degrade',
    });
    expect(summary).toContain('supported model versions: (none)');
    expect(summary).toContain('emitted/read sections: (none)');
    expect(summary).toContain('unsupported constructs: none');
    expect(summary).toContain('NOTE: this adapter does not declare support for IR model version 0.1');
  });

  test('constructs with exotic characters still echo verbatim', () => {
    const weird = 'IrComponent.events ["click","focus"] — nested quotes "and" \\backslashes\\';
    const summary = describeIrAdapter({ ...FULL, unsupportedConstructs: [weird] });
    expect(summary).toContain(weird);
  });
});

describe('describeIrAdapter — malformed declarations are rejected', () => {
  test('non-object info', () => {
    expect(() => describeIrAdapter(null as unknown as IrAdapterInfo)).toThrow(IrAdapterError);
    expect(() => describeIrAdapter(undefined as unknown as IrAdapterInfo)).toThrow(IrAdapterError);
    expect(() => describeIrAdapter('adapter' as unknown as IrAdapterInfo)).toThrow(IrAdapterError);
  });

  test('missing or empty adapterId', () => {
    expect(() => describeIrAdapter({ ...FULL, adapterId: '' })).toThrow(/adapterId/);
    expect(() => describeIrAdapter({ ...FULL, adapterId: 42 as unknown as string })).toThrow(/adapterId/);
  });

  test('non-array string fields', () => {
    expect(() => describeIrAdapter({ ...FULL, supportedModelVersions: '0.1' as unknown as string[] })).toThrow(
      /supportedModelVersions/,
    );
    expect(() => describeIrAdapter({ ...FULL, unsupportedConstructs: null as unknown as string[] })).toThrow(
      /unsupportedConstructs/,
    );
    expect(() => describeIrAdapter({ ...FULL, emittedCapabilities: undefined as unknown as string[] })).toThrow(
      /emittedCapabilities/,
    );
  });

  test('empty-string entries inside arrays', () => {
    expect(() => describeIrAdapter({ ...FULL, supportedModelVersions: ['0.1', ''] })).toThrow(/supportedModelVersions\[1\]/);
    expect(() => describeIrAdapter({ ...FULL, unsupportedConstructs: [''] })).toThrow(/unsupportedConstructs\[0\]/);
  });

  test('missing or empty degradationBehavior', () => {
    expect(() => describeIrAdapter({ ...FULL, degradationBehavior: '' })).toThrow(/degradationBehavior/);
    expect(() => describeIrAdapter({ ...FULL, degradationBehavior: undefined as unknown as string })).toThrow(
      /degradationBehavior/,
    );
  });
});
