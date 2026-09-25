// CLAPP-020 — model stats: section counts and the three derived
// breakdowns (roles, provenance levels, evidence kinds) over the b01
// reference model, an empty model, and a defensively-shaped garbage input.

import { describe, expect, test } from 'bun:test';
import { createIrModelBuilder } from './builder';
import { irModelStats } from './stats';
import { buildReferenceModel, IDS } from './test-model';

describe('irModelStats — reference model counts', () => {
  const stats = irModelStats(buildReferenceModel());

  test('section counts', () => {
    expect(stats.modelVersion).toBe('0.1');
    expect(stats.screens).toBe(3);
    expect(stats.components).toBe(4);
    expect(stats.stateVariables).toBe(1);
    expect(stats.transitions).toBe(1);
    expect(stats.dataEntities).toBe(1);
    expect(stats.dataFields).toBe(1);
    expect(stats.apiOperations).toBe(1);
    expect(stats.integrations).toBe(1);
    expect(stats.assumptions).toBe(1);
    expect(stats.journeys).toBe(1);
    expect(stats.evidenceEntries).toBe(6);
    expect(stats.constraints).toBe(2);
  });

  test('componentsByRole', () => {
    expect(stats.componentsByRole).toEqual({ button: 1, heading: 1, list: 1, navigation: 1 });
  });

  test('provenanceByLevel counts every contract provenance block', () => {
    // journeys(1 derived) + screens(3 observed) + components(4 observed) +
    // state.variables(1 derived) + state.transitions(1 derived) +
    // data fields(1 observed) + api.operations(1 assumed) +
    // integrations(1 unavailable) + assumptions(1 assumed)
    expect(stats.provenanceByLevel).toEqual({
      observed: 8,
      derived: 3,
      inferred: 0,
      assumed: 2,
      unavailable: 1,
    });
  });

  test('evidenceByKind (total over the core EvidenceKind vocabulary)', () => {
    expect(stats.evidenceByKind).toEqual({
      dom: 3,
      network: 1,
      runtime: 0,
      screenshot: 1,
      static: 0,
      storage: 1,
      user: 0,
    });
  });

  test('breakdown sums equal the element totals', () => {
    const roleTotal = Object.values(stats.componentsByRole).reduce((a, b) => a + b, 0);
    expect(roleTotal).toBe(stats.components);
    const levelTotal = Object.values(stats.provenanceByLevel).reduce((a, b) => a + b, 0);
    expect(levelTotal).toBe(14);
    const kindTotal = Object.values(stats.evidenceByKind).reduce((a, b) => a + b, 0);
    expect(kindTotal).toBe(stats.evidenceEntries);
  });
});

describe('irModelStats — empty and defensive cases', () => {
  test('a fresh builder model stats to zero everywhere', () => {
    const model = createIrModelBuilder({
      application: { id: IDS.application, name: 'Nimbus Notes', platform: 'web', entrypoints: ['/'] },
    }).finish();
    const stats = irModelStats(model);
    expect(stats.screens).toBe(0);
    expect(stats.components).toBe(0);
    expect(stats.stateVariables).toBe(0);
    expect(stats.transitions).toBe(0);
    expect(stats.dataEntities).toBe(0);
    expect(stats.dataFields).toBe(0);
    expect(stats.apiOperations).toBe(0);
    expect(stats.integrations).toBe(0);
    expect(stats.assumptions).toBe(0);
    expect(stats.journeys).toBe(0);
    expect(stats.evidenceEntries).toBe(0);
    expect(stats.constraints).toBe(0);
    expect(stats.componentsByRole).toEqual({});
    expect(stats.provenanceByLevel).toEqual({ observed: 0, derived: 0, inferred: 0, assumed: 0, unavailable: 0 });
    expect(stats.evidenceByKind).toEqual({
      dom: 0,
      network: 0,
      runtime: 0,
      screenshot: 0,
      static: 0,
      storage: 0,
      user: 0,
    });
  });

  test('mechanical and non-throwing on structurally broken input (no validation)', () => {
    const stats = irModelStats({ modelVersion: 42 } as unknown as ReturnType<typeof buildReferenceModel>);
    expect(stats.modelVersion).toBe('0.1');
    expect(stats.screens).toBe(0);
    expect(stats.components).toBe(0);
  });
});
