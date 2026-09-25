// CLAPP-021 unit — extractIrModel orchestration: application/environment,
// evidence catalog + citation stats, structural self-check, honesty
// invariants (empty evidenceRefs only on 'assumed'), determinism of shape.

import { describe, expect, test } from 'bun:test';
import { EXTRACT_ADAPTER_INFO, extractIrModel } from './extraction';
import type { IrModel, Provenance } from './ir-contract';
import { IR_MODEL_VERSION } from './ir-contract';
import { checkIrLiteral, collectCitedEvidenceRefs } from './check-ir-literal';
import {
  SynthClock,
  docRequestCapture,
  domTreeCapture,
  el,
  extractFromSynth,
  pageTree,
  requestCapture,
  responseCapture,
  runtimeCapture,
  screenshotCapture,
  storageInventoryCapture,
  synthBundle,
  wsFrameCapture,
} from './test-utils';

const clock = new SynthClock();

function fullTree(): ReturnType<typeof pageTree> {
  return pageTree([
    el('a', 'link', { text: 'Pricing', attrs: { href: '/pricing' } }),
    el('button', 'button', { text: 'Buy' }),
  ]);
}

function fullSynth() {
  return synthBundle([
    docRequestCapture('http://synth.test/', clock.next()),
    domTreeCapture(fullTree(), clock.next()),
    screenshotCapture(clock.next()),
    requestCapture('http://synth.test/api/items/42', 'GET', clock.next()),
    responseCapture('http://synth.test/api/items/42', 'GET', 200, clock.next(), { bodyPreview: '{"items":[]}' }),
    docRequestCapture('http://synth.test/pricing', clock.next()),
    domTreeCapture(fullTree(), clock.next()),
    storageInventoryCapture(clock.next(), { localStorage: [{ key: 'theme', valuePreview: '"dark"' }] }),
    wsFrameCapture('ws://synth.test/live', 'sent', '{"t":"hi"}', clock.next()),
    wsFrameCapture('ws://synth.test/live', 'received', '{"t":"hello"}', clock.next()),
    runtimeCapture(clock.next()),
  ], { targetId: 'bench/synth-full', environment: { browser: 'synth-chromium', os: 'synth-linux', network: 'deny-all', viewport: { width: 1280, height: 720 } } });
}

describe('extractIrModel — model identity', () => {
  test('application: name from run.targetId, platform web, entrypoints = first route', async () => {
    const synth = await fullSynth();
    const { model } = await extractFromSynth(synth);
    expect(model.modelVersion).toBe(IR_MODEL_VERSION);
    expect(model.application.name).toBe('bench/synth-full');
    expect(model.application.platform).toBe('web');
    expect(model.application.entrypoints).toEqual(['/']);
    expect(model.application.id.startsWith('app_')).toBe(true);
  });

  test('environment passes through well-typed run.environment fields only', async () => {
    const synth = await fullSynth();
    const { model } = await extractFromSynth(synth);
    expect(model.environment).toEqual({
      browser: 'synth-chromium',
      os: 'synth-linux',
      network: 'deny-all',
      viewport: { width: 1280, height: 720 },
    });
  });

  test('environment omits unknown/mistyped fields (absent, never null)', async () => {
    const synth = await synthBundle([docRequestCapture('http://synth.test/', clock.next())], {
      environment: { browser: 42, locale: 'en-US', junk: { nested: true } },
    });
    const { model } = await extractFromSynth(synth);
    expect(model.environment).toEqual({ locale: 'en-US' });
    expect('browser' in model.environment).toBe(false);
  });
});

describe('extractIrModel — evidence catalog and citations', () => {
  test('catalog lists EVERY manifest ref with run-scoped source; citations resolve', async () => {
    const synth = await fullSynth();
    const { model, stats } = await extractFromSynth(synth);
    const manifestRefs = synth.bundle.manifest.evidence;
    expect(model.evidence.length).toBe(manifestRefs.length);
    for (const entry of model.evidence) {
      expect(entry.id.startsWith('irev_')).toBe(true);
      expect(entry.source).toBe(`run:${synth.runId}:${entry.ref.kind}`);
    }
    const catalogIds = new Set(model.evidence.map((entry) => entry.ref.evidenceId));
    for (const ref of manifestRefs) {
      expect(catalogIds.has(ref.evidenceId)).toBe(true);
    }
    // cited ⊆ catalog, and the stat counts distinct cited refs
    const cited = collectCitedEvidenceRefs(model);
    expect(cited.length).toBe(stats.evidenceCited);
    expect(stats.evidenceCited).toBeGreaterThan(0);
    expect(stats.evidenceCited).toBeLessThanOrEqual(model.evidence.length);
  });

  test('stats count captures, screens, operations, transitions', async () => {
    const synth = await fullSynth();
    const { stats } = await extractFromSynth(synth);
    // 11 captures recorded; 1 runtime:console skipped
    expect(stats.capturesParsed).toBe(10);
    expect(stats.capturesSkipped).toBe(1);
    expect(stats.screensEmitted).toBe(2);
    expect(stats.operationsEmitted).toBe(4); // GET /, GET /pricing, GET /api/items/:id, ws /live
    expect(stats.transitionsEmitted).toBe(1);
  });
});

describe('extractIrModel — structural self-check (internal contract invariants)', () => {
  test('a full extraction passes checkIrLiteral with zero violations', async () => {
    const synth = await fullSynth();
    const { model } = await extractFromSynth(synth);
    expect(checkIrLiteral(model, synth.bundle.manifest.evidence)).toEqual([]);
  });

  test('the self-check catches referential-integrity violations (negative control)', () => {
    const broken: IrModel = {
      modelVersion: IR_MODEL_VERSION,
      application: { id: 'app_00000000-0000-4000-8000-000000000000', name: 'x', platform: 'web', entrypoints: [] },
      environment: {},
      evidence: [],
      journeys: [],
      screens: [
        {
          id: 'screen_00000000-0000-4000-8000-000000000000',
          route: '/',
          provenance: {
            level: 'derived',
            confidence: { value: 0.9, rationale: 'r', evidenceRefs: [{ evidenceId: 'ev_ghost', kind: 'dom', sha256: 'a'.repeat(64) }] },
          },
        },
      ],
      components: [
        {
          id: 'comp_00000000-0000-4000-8000-000000000000',
          role: 'link',
          screenId: 'screen_missing',
          properties: {},
          events: [],
          provenance: { level: 'assumed', confidence: { value: 0.3, rationale: 'r', evidenceRefs: [] } },
        },
      ],
      state: { variables: [], transitions: [] },
      data: { entities: [] },
      api: { operations: [] },
      integrations: [],
      assumptions: [],
      constraints: [],
    };
    const violations = checkIrLiteral(broken, []);
    expect(violations.some((violation) => violation.includes('ev_ghost'))).toBe(true);
    expect(violations.some((violation) => violation.includes('screen_missing'))).toBe(true);
  });

  test('the self-check catches null values and non-round-trip models (negative control)', () => {
    const base: IrModel = {
      modelVersion: IR_MODEL_VERSION,
      application: { id: 'app_00000000-0000-4000-8000-000000000000', name: 'x', platform: 'web', entrypoints: [] },
      environment: {},
      evidence: [],
      journeys: [],
      screens: [],
      components: [],
      state: { variables: [], transitions: [] },
      data: { entities: [] },
      api: { operations: [] },
      integrations: [],
      assumptions: [],
      constraints: null as unknown as string[],
    };
    expect(checkIrLiteral(base, []).some((violation) => violation.includes('null'))).toBe(true);
  });
});

describe('extractIrModel — honesty invariants', () => {
  test('empty-evidence refs appear ONLY on assumed-level provenance blocks', async () => {
    const synth = await fullSynth();
    const { model } = await extractFromSynth(synth);
    const provenances: Provenance[] = [];
    for (const screen of model.screens) provenances.push(screen.provenance);
    for (const component of model.components) provenances.push(component.provenance);
    for (const variable of model.state.variables) provenances.push(variable.provenance);
    for (const transition of model.state.transitions) provenances.push(transition.provenance);
    for (const entity of model.data.entities) {
      for (const field of entity.fields) provenances.push(field.provenance);
    }
    for (const operation of model.api.operations) provenances.push(operation.provenance);
    for (const assumption of model.assumptions) provenances.push(assumption.provenance);
    expect(provenances.length).toBeGreaterThan(10);
    for (const provenance of provenances) {
      if (provenance.level !== 'assumed') {
        expect(provenance.confidence.evidenceRefs.length).toBeGreaterThan(0);
      }
    }
  });

  test('an empty bundle extracts to an honest empty model (no invented content)', async () => {
    const synth = await synthBundle([], { targetId: 'bench/empty' });
    const result = await extractFromSynth(synth);
    const { model, stats, warnings } = result;
    expect(model.screens).toEqual([]);
    expect(model.components).toEqual([]);
    expect(model.state.variables).toEqual([]);
    expect(model.state.transitions).toEqual([]);
    expect(model.data.entities).toEqual([]);
    expect(model.api.operations).toEqual([]);
    expect(model.assumptions).toEqual([]);
    expect(model.evidence).toEqual([]);
    expect(model.journeys).toEqual([]);
    expect(model.integrations).toEqual([]);
    expect(model.application.entrypoints).toEqual([]);
    expect(stats).toEqual({
      capturesParsed: 0,
      capturesSkipped: 0,
      evidenceCited: 0,
      screensEmitted: 0,
      operationsEmitted: 0,
      transitionsEmitted: 0,
    });
    expect(warnings).toEqual([]);
    expect(model.constraints.length).toBe(2);
    expect(checkIrLiteral(model, synth.bundle.manifest.evidence)).toEqual([]);
  });

  test('degraded captures never abort the extraction (mixed good/bad input)', async () => {
    const synth = await synthBundle([
      docRequestCapture('http://synth.test/', clock.next()),
      domTreeCapture(fullTree(), clock.next()),
      runtimeCapture(clock.next()),
      { kind: 'dom', ts: clock.next(), payload: { subkind: 'dom-mutation' }, redacted: false },
    ]);
    const result = await extractFromSynth(synth);
    expect(result.model.screens.length).toBe(1);
    expect(result.stats.capturesSkipped).toBe(2);
    expect(result.warnings.length).toBe(2);
  });

  test('extraction of the same bundle is shape-stable across runs (ids aside)', async () => {
    const synth = await fullSynth();
    const first = await extractFromSynth(synth);
    const second = await extractFromSynth(synth);
    const shape = (model: IrModel) => JSON.stringify({
      routes: model.screens.map((screen) => screen.route),
      components: model.components.map((component) => [component.role, component.properties['name']]),
      operations: model.api.operations.map((operation) => [operation.transport, operation.method, operation.urlPattern, operation.replayability]),
      transitions: model.state.transitions.map((transition) => transition.trigger),
      entities: model.data.entities.map((entity) => entity.persistence),
      variables: model.state.variables.map((variable) => [variable.name, variable.domain]),
      constraints: model.constraints.length,
      warnings: first.warnings, // warnings are deterministic content
    });
    expect(shape(second.model)).toBe(shape(first.model));
    expect(second.stats).toEqual(first.stats);
  });
});

describe('extractIrModel — input guards and adapter declaration', () => {
  test('grossly malformed input throws TypeError', async () => {
    await expect(extractIrModel({ bundle: null as never, readArtifact: async () => null })).rejects.toThrow('input');
    const synth = await synthBundle([docRequestCapture('http://synth.test/', clock.next())]);
    await expect(
      extractIrModel({ bundle: synth.bundle, readArtifact: 'not a function' as never }),
    ).rejects.toThrow('readArtifact');
    await expect(
      extractIrModel({ bundle: { manifest: {} } as never, readArtifact: async () => null }),
    ).rejects.toThrow('manifest.run');
  });

  test('EXTRACT_ADAPTER_INFO declares model version and honest support', () => {
    expect(EXTRACT_ADAPTER_INFO.adapterId).toBe('@clapp/extract');
    expect(EXTRACT_ADAPTER_INFO.supportedModelVersions).toEqual([IR_MODEL_VERSION]);
    expect(EXTRACT_ADAPTER_INFO.emittedCapabilities.length).toBeGreaterThan(5);
    expect(EXTRACT_ADAPTER_INFO.unsupportedConstructs.some((construct) => construct.includes('journeys'))).toBe(true);
    expect(EXTRACT_ADAPTER_INFO.degradationBehavior).toContain('never');
  });
});
