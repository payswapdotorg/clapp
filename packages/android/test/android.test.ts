// CLAPP-080 — the Android adapter tests (the P8 opener — Worker 1).
//
// Eight named tests over the five v0.1 components: the fail-closed
// environment validator (every malformation named with its observed
// value), the honest observation measurement (digest, node count,
// observed depth — the digest RECOMPUTED independently from the same
// core hash + canonical serializer), the observation budget law
// (over-depth trees refuse — nothing observed), the evidence emitter
// (core-shaped EvidenceRefs — no IR forking — deterministic 'andev_'
// ids, unknown kinds named), the synthesis-target validator (the
// frozen density vocabulary), the honest verification counts through
// the host seam (completed/failed MEASURED, reasons VERBATIM in journey
// order), the loud-host law (a rejecting host REJECTS through — both
// seams, the rejection identity asserted), and the import-discipline
// pin (the no-fork law over the exact src file list: @clapp/core +
// @clapp/observe at RUNTIME, @clapp/diff + @clapp/ir + @clapp/journey
// TYPE-ONLY, no other packages).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { EVIDENCE_KINDS, sha256Hex } from '@clapp/core';
import type { EvidenceKind, EvidenceRef } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import { validateAndroidEnvironment } from '../src/environment';
import { observeAndroidScreen } from '../src/observation';
import type { AndroidObservation, AndroidObservationResult, AndroidViewNode } from '../src/observation';
import { emitObservationEvidence } from '../src/evidence';
import { validateAndroidSynthesisTarget } from '../src/synthesis-target';
import { verifyAndroidJourneys } from '../src/verification';
import type { AndroidVerificationResult, AndroidVerificationRun } from '../src/verification';

import { VALID_ENVIRONMENT, malformedEnvironment } from './fixtures/environments';
import { DEPTH_FOUR_TREE, SEVEN_NODE_TREE } from './fixtures/view-trees';
import { VALID_TARGET, malformedTarget } from './fixtures/targets';
import { fakeObservationHost, fakeVerificationHost } from './fixtures/fake-hosts';

/** Unwraps an ok observation (a refusal fails the test loudly, never silently). */
function observationOf(result: AndroidObservationResult): AndroidObservation {
  if (!result.ok) {
    throw new Error(`expected an ok observation, got errors: ${result.errors.join('; ')}`);
  }
  return result.observation;
}

/** Unwraps an ok verification run (a refusal fails the test loudly, never silently). */
function runOf(result: AndroidVerificationResult): AndroidVerificationRun {
  if (!result.ok) {
    throw new Error(`expected an ok verification run, got errors: ${result.errors.join('; ')}`);
  }
  return result.run;
}

/** The node count, recomputed independently here (measured by traversal, never trusted). */
function countNodes(viewNode: AndroidViewNode): number {
  return 1 + viewNode.children.reduce((total, child) => total + countNodes(child), 0);
}

/** The tree depth, recomputed independently here (the root is depth 1). */
function depthOf(viewNode: AndroidViewNode): number {
  if (viewNode.children.length === 0) {
    return 1;
  }
  return 1 + Math.max(...viewNode.children.map((child) => depthOf(child)));
}

/** Recursively lists every .ts file under dir (the house imports-test helper). */
function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** Named import/export-from statements: (clause, specifier) pairs (the house helper). */
const FROM_RE = /^[ \t]*(?:import|export)\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm;

/** Bare side-effect imports: `import '…'` (the house helper). */
const BARE_RE = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;

/** Dynamic imports: `import('…')` (the house helper). */
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function sourceImports(source: string): Array<{ clause: string; specifier: string }> {
  const found: Array<{ clause: string; specifier: string }> = [];
  for (const match of source.matchAll(FROM_RE)) {
    found.push({ clause: (match[1] ?? '').trim(), specifier: match[2] ?? '' });
  }
  return found;
}

describe('CLAPP-080 — the Android adapter (the P8 opener)', () => {
  test('the environment validator is fail-closed with named errors for every malformation', () => {
    // The valid fixture passes.
    expect(validateAndroidEnvironment(VALID_ENVIRONMENT)).toEqual({ ok: true });

    // Every malformation refuses, naming its field AND the observed value.
    const cases: Array<{ patch: Record<string, unknown>; names: string[] }> = [
      { patch: { platform: 'ios' }, names: ['platform', 'ios'] },
      { patch: { environmentVersion: '0.2' }, names: ['environmentVersion', '0.2'] },
      { patch: { apiLevel: 0 }, names: ['apiLevel'] },
      { patch: { screenDp: { width: 412, height: -5 } }, names: ['screenDp.height'] },
      {
        patch: { grantedPermissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'] },
        names: ['grantedPermissions', 'android.permission.RECORD_AUDIO'],
      },
      {
        patch: { grantedPermissions: ['android.permission.INTERNET', 'android.permission.CAMERA'] },
        names: ['grantedPermissions', 'sorted'],
      },
      {
        patch: { grantedPermissions: ['android.permission.CAMERA', 'android.permission.CAMERA'] },
        names: ['grantedPermissions', 'duplicate'],
      },
      { patch: { maxHierarchyDepth: 2.5 }, names: ['maxHierarchyDepth'] },
    ];

    for (const { patch, names } of cases) {
      const result = validateAndroidEnvironment(malformedEnvironment(patch));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        for (const name of names) {
          expect(result.errors.some((error) => error.includes(name))).toBe(true);
        }
      }
    }
  });

  test('observation measures the capture honestly — digest, node count, and observed depth', async () => {
    const observation = observationOf(
      await observeAndroidScreen(fakeObservationHost(SEVEN_NODE_TREE), VALID_ENVIRONMENT),
    );

    // The digest is RECOMPUTED independently here — the same core hash
    // over the same canonical serialization — and must equal the
    // measured one.
    const expectedDigest = await sha256Hex(canonicalJson(SEVEN_NODE_TREE));
    expect(observation.screenDigest).toBe(expectedDigest);

    // The counts: the fixture's shape (7 nodes, depth 3), measured by
    // traversal AND recomputed independently here.
    expect(observation.nodeCount).toBe(7);
    expect(observation.observedDepth).toBe(3);
    expect(observation.nodeCount).toBe(countNodes(SEVEN_NODE_TREE));
    expect(observation.observedDepth).toBe(depthOf(SEVEN_NODE_TREE));

    // The observation runs under the validated environment's version.
    expect(observation.environmentVersion).toBe(VALID_ENVIRONMENT.environmentVersion);
  });

  test('over-depth trees refuse — the observation budget is a law', async () => {
    const result = await observeAndroidScreen(fakeObservationHost(DEPTH_FOUR_TREE), VALID_ENVIRONMENT);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('a depth-4 tree against maxHierarchyDepth 3 must refuse');
    }
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((error) => error.includes('maxHierarchyDepth'))).toBe(true);
    expect(result.errors.some((error) => error.includes('depth'))).toBe(true);
  });

  test('the evidence emitter mints core-shaped EvidenceRefs — no IR forking, deterministic ids', async () => {
    const observation = observationOf(
      await observeAndroidScreen(fakeObservationHost(SEVEN_NODE_TREE), VALID_ENVIRONMENT),
    );
    const kind = EVIDENCE_KINDS[0];

    const first = emitObservationEvidence(observation, kind);
    const second = emitObservationEvidence(observation, kind);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error('a measured observation with a frozen kind must emit');
    }

    // Deterministic: the same capture + kind mint deep-equal evidence.
    expect(first.evidence).toEqual(second.evidence);

    // TYPE-LEVEL assertion: the emitted value IS the core's EvidenceRef
    // (the frozen shape consumed type-only — never a forked lookalike).
    const coreShaped: EvidenceRef = first.evidence;

    // The 'andev_' id is derived from the digest: prefix + first 32
    // hex chars + '-' + kind.
    expect(coreShaped.evidenceId).toBe(`andev_${observation.screenDigest.slice(0, 32)}-${kind}`);
    expect(coreShaped.evidenceId.startsWith('andev_')).toBe(true);
    expect(coreShaped.kind).toBe(kind);
    expect(coreShaped.sha256).toBe(observation.screenDigest);

    // An unknown kind is a NAMED error — never an invented one.
    const forgedKind: string = 'definitely-not-a-frozen-kind';
    const unknownKind = emitObservationEvidence(observation, forgedKind as EvidenceKind);
    expect(unknownKind.ok).toBe(false);
    if (!unknownKind.ok) {
      expect(unknownKind.errors.some((error) => error.includes('kind'))).toBe(true);
      expect(unknownKind.errors.some((error) => error.includes('definitely-not-a-frozen-kind'))).toBe(true);
    }
  });

  test('the synthesis target validator enforces the frozen vocabularies', () => {
    // The valid target passes.
    expect(validateAndroidSynthesisTarget(VALID_TARGET)).toEqual({ ok: true });

    // An unknown density refuses, naming the observed value.
    const unknownDensity = validateAndroidSynthesisTarget(
      malformedTarget({ densities: ['hdpi', 'retina'] }),
    );
    expect(unknownDensity.ok).toBe(false);
    if (!unknownDensity.ok) {
      expect(unknownDensity.errors.some((error) => error.includes('retina'))).toBe(true);
    }

    // Unsorted activities refuse, named.
    const unsortedActivities = validateAndroidSynthesisTarget(
      malformedTarget({ activities: ['SettingsActivity', 'MainActivity'] }),
    );
    expect(unsortedActivities.ok).toBe(false);
    if (!unsortedActivities.ok) {
      expect(unsortedActivities.errors.some((error) => error.includes('sorted'))).toBe(true);
    }

    // An empty applicationId refuses, named.
    const emptyApplicationId = validateAndroidSynthesisTarget(
      malformedTarget({ applicationId: '' }),
    );
    expect(emptyApplicationId.ok).toBe(false);
    if (!emptyApplicationId.ok) {
      expect(emptyApplicationId.errors.some((error) => error.includes('applicationId'))).toBe(true);
    }
  });

  test('verification counts honestly through the host seam — completed and failed measured, reasons verbatim', async () => {
    const journeys = ['journey-a', 'journey-b', 'journey-c'];
    const { host, calls } = fakeVerificationHost({
      'journey-a': { completed: true },
      'journey-b': { completed: false, failureReason: 'button not found' },
      'journey-c': { completed: true },
    });

    const run = runOf(await verifyAndroidJourneys(host, journeys, VALID_ENVIRONMENT));

    // Every journey ran through the host, in the sorted order —
    // asserted from the host's own recording, never trusted.
    expect(calls).toEqual(journeys);
    expect(run.journeyIds).toEqual(journeys);

    // MEASURED counts: 2 completed, 1 failed.
    expect(run.completed).toBe(2);
    expect(run.failed).toBe(1);
    expect(run.completed + run.failed).toBe(journeys.length);

    // The failure reason rides VERBATIM, in journey order.
    expect(run.failures).toEqual([{ journeyId: 'journey-b', reason: 'button not found' }]);

    // The run executes under the validated environment's version.
    expect(run.environmentVersion).toBe(VALID_ENVIRONMENT.environmentVersion);
  });

  test('a throwing host propagates loudly — never swallowed, never a synthetic result', async () => {
    // The observation seam: a rejecting host REJECTS through, the
    // rejection identity asserted.
    const observationBoom = new Error('observation host exploded');
    const throwingObserver = {
      captureScreen: () => Promise.reject(observationBoom),
    };
    let observationRejected = false;
    let observationCaught: unknown = undefined;
    try {
      await observeAndroidScreen(throwingObserver, VALID_ENVIRONMENT);
    } catch (error) {
      observationRejected = true;
      observationCaught = error;
    }
    expect(observationRejected).toBe(true);
    expect(observationCaught).toBe(observationBoom);

    // The verification seam: a rejecting host REJECTS through, the
    // rejection identity asserted.
    const verificationBoom = new Error('verification host exploded');
    const throwingVerifier = {
      runJourney: () => Promise.reject(verificationBoom),
    };
    let verificationRejected = false;
    let verificationCaught: unknown = undefined;
    try {
      await verifyAndroidJourneys(throwingVerifier, ['journey-a'], VALID_ENVIRONMENT);
    } catch (error) {
      verificationRejected = true;
      verificationCaught = error;
    }
    expect(verificationRejected).toBe(true);
    expect(verificationCaught).toBe(verificationBoom);
  });

  test('the package imports only frozen contracts — the no-fork law is pinned', () => {
    const packageRoot = dirname(import.meta.dir); // packages/android (one level above test/)

    // ---- 1. the exact src file list (the delivered surface) ----
    const srcFiles = listTsFiles(join(packageRoot, 'src')).sort();
    expect(srcFiles.map((file) => file.slice(packageRoot.length + 1))).toEqual([
      'src/environment.ts',
      'src/evidence.ts',
      'src/index.ts',
      'src/observation.ts',
      'src/synthesis-target.ts',
      'src/verification.ts',
    ]);

    const runtimeAllowed = new Set(['@clapp/core', '@clapp/observe']);
    const typeOnlyAllowed = new Set(['@clapp/diff', '@clapp/ir', '@clapp/journey']);
    const violations: string[] = [];

    // ---- 2. src/** — @clapp/core + @clapp/observe at RUNTIME;
    //         @clapp/diff + @clapp/ir + @clapp/journey TYPE-ONLY;
    //         no other packages ----
    for (const file of srcFiles) {
      const display = file.slice(packageRoot.length + 1);
      const source = readFileSync(file, 'utf8');

      for (const { clause, specifier } of sourceImports(source)) {
        if (specifier.startsWith('@clapp/')) {
          if (runtimeAllowed.has(specifier)) {
            continue; // a declared runtime dependency — the frozen contracts in force
          }
          if (typeOnlyAllowed.has(specifier)) {
            if (!clause.startsWith('type')) {
              violations.push(
                `${display}: RUNTIME import of ${JSON.stringify(specifier)} — the no-fork law allows TYPE-ONLY imports of it`,
              );
            }
            continue;
          }
          violations.push(
            `${display}: undeclared workspace dependency ${JSON.stringify(specifier)} — the dependency set is @clapp/core + @clapp/observe (runtime) and @clapp/diff + @clapp/ir + @clapp/journey (type-only)`,
          );
          continue;
        }
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
          continue; // relative module or a runtime-provided builtin — not a package
        }
        violations.push(`${display}: non-workspace package import ${JSON.stringify(specifier)}`);
      }

      for (const match of source.matchAll(BARE_RE)) {
        violations.push(`${display}: bare side-effect import ${JSON.stringify(match[1] ?? '')}`);
      }
      for (const match of source.matchAll(DYNAMIC_RE)) {
        const specifier = match[1] ?? '';
        if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
          violations.push(`${display}: dynamic import ${JSON.stringify(specifier)}`);
        }
      }
    }

    // ---- 3. test/fixtures/** — @clapp imports are TYPE-ONLY, relative allowed ----
    for (const file of listTsFiles(join(packageRoot, 'test', 'fixtures')).sort()) {
      const display = file.slice(packageRoot.length + 1);
      const source = readFileSync(file, 'utf8');

      for (const { clause, specifier } of sourceImports(source)) {
        if (specifier.startsWith('@clapp/')) {
          if (!clause.startsWith('type')) {
            violations.push(
              `${display}: RUNTIME import of ${JSON.stringify(specifier)} — fixtures import @clapp packages for types only`,
            );
          }
          continue;
        }
        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          continue; // relative module — the fixtures' own files
        }
        violations.push(
          `${display}: non-relative fixture import ${JSON.stringify(specifier)} — fixtures are plain data builders`,
        );
      }

      for (const match of source.matchAll(BARE_RE)) {
        violations.push(`${display}: bare side-effect import ${JSON.stringify(match[1] ?? '')}`);
      }
      for (const match of source.matchAll(DYNAMIC_RE)) {
        const specifier = match[1] ?? '';
        if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
          violations.push(`${display}: dynamic import ${JSON.stringify(specifier)}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
