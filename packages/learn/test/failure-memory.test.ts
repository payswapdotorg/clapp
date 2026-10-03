// CLAPP-060 — the failure memory tests (the W3 learning-lane opener).
//
// Fixtures: test/fixtures/failure-fixtures.ts (minimal DiffFinding-shaped
// literals over the frozen diff-contract v0.1 vocabulary + the honest
// repair-facts derivation from RepairLoopResult-shaped literals). The
// eight named tests cover the packet's axes: determinism, fail-closed
// admission, content-addressed identities (duplicates refused,
// recurrences distinct), honest signature derivation, honest queries,
// canonical defensively-copied listings, the content-addressed snapshot,
// and the frozen-contract import discipline.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { FAILURE_VERSION, createFailureMemory } from '../src/failure-memory';
import type { FailureMemory, FailureRecord } from '../src/failure-memory';
import type { FailureEventInput } from './fixtures/failure-fixtures';
import {
  OBSERVED_AT_A,
  OBSERVED_AT_B,
  OBSERVED_AT_C,
  diffFinding,
  failureEvent,
  packageRef,
  repairFacts,
} from './fixtures/failure-fixtures';

/** The login-postcondition signature two events share (a recurrence pair). */
const LOGIN_SUMMARY = 'The candidate misses the login postcondition.';

const eventAlpha = failureEvent({
  finding: diffFinding({
    id: 'diff_alpha',
    dimension: 'semantic',
    severity: 'critical',
    summary: LOGIN_SUMMARY,
    expected: { status: 200 },
    actual: { status: 401 },
  }),
  packageRef: packageRef('a1'),
  target: 'bench/b01-static',
  context: 'paired replay of journey j01, step 2',
  generalized: true,
});

const eventBeta = failureEvent({
  finding: diffFinding({
    id: 'diff_beta',
    dimension: 'semantic',
    severity: 'critical',
    summary: LOGIN_SUMMARY,
    expected: { status: 200 },
    actual: { status: 403 },
  }),
  packageRef: packageRef('b2'),
  target: 'bench/b02-dashboard',
  context: 'paired replay of journey j02, step 1',
});

const eventGamma = failureEvent({
  finding: diffFinding({
    id: 'diff_gamma',
    dimension: 'state',
    severity: 'minor',
    summary: 'A localStorage key diverges after login.',
  }),
  target: 'bench/b01-static',
  context: 'paired replay of journey j01, step 3',
});

const eventDelta = failureEvent({
  finding: diffFinding({
    id: 'diff_delta',
    dimension: 'network',
    severity: 'major',
    summary: 'The mock API returns the wrong response shape.',
    expected: { items: 2 },
    actual: { items: 0 },
  }),
  packageRef: packageRef('c3'),
  target: 'bench/b02-dashboard',
  context: 'paired replay of journey j02, step 4',
});

/** Record and be loud about it — a fixture failure must not pass silently. */
async function admit(
  memory: FailureMemory,
  event: FailureEventInput,
  observedAt: string,
): Promise<FailureRecord> {
  const result = await memory.record(event, { observedAt });
  if (!result.ok) {
    throw new Error(`admission failed: ${result.errors.join('; ')}`);
  }
  return result.record;
}

// ---- the import-discipline test's machinery (module level, like the library's) ------

/** The frozen contract owners: import-type ONLY (src/** and test/fixtures/**). */
const CONTRACT_PACKAGES = ['@clapp/diff', '@clapp/repair'] as const;

/** The complete runtime dependency set. */
const RUNTIME_ALLOWED = new Set(['@clapp/core', '@clapp/library', '@clapp/observe']);

const PACKAGE_ROOT = dirname(import.meta.dir); // packages/learn (one level above test/)
const SRC_ROOT = join(PACKAGE_ROOT, 'src');
const FIXTURES_ROOT = join(PACKAGE_ROOT, 'test', 'fixtures');

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

/** Named import/export-from statements: (clause, specifier) pairs. */
const FROM_RE = /^[ \t]*(?:import|export)\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm;

/** Bare side-effect imports: `import '…'`. */
const BARE_RE = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;

/** Dynamic imports: `import('…')`. */
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function sourceImports(source: string): Array<{ clause: string; specifier: string }> {
  const found: Array<{ clause: string; specifier: string }> = [];
  for (const match of source.matchAll(FROM_RE)) {
    found.push({ clause: (match[1] ?? '').trim(), specifier: match[2] ?? '' });
  }
  return found;
}

/** Bare + dynamic import checks shared by the src/** and fixtures/** scans. */
function checkNoSideEffectImports(
  violations: string[],
  display: string,
  source: string,
): void {
  for (const match of source.matchAll(BARE_RE)) {
    violations.push(`${display}: bare side-effect import ${JSON.stringify(match[1])}`);
  }
  for (const match of source.matchAll(DYNAMIC_RE)) {
    const specifier = match[1] ?? '';
    if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
      violations.push(`${display}: dynamic import ${JSON.stringify(specifier)}`);
    }
  }
}

describe('the failure memory (CLAPP-060)', () => {
  test('the failure memory is deterministic — identical events in any input order produce identical snapshots', async () => {
    const forward = createFailureMemory();
    await admit(forward, eventAlpha, OBSERVED_AT_A);
    await admit(forward, eventBeta, OBSERVED_AT_B);
    await admit(forward, eventGamma, OBSERVED_AT_C);

    const reverse = createFailureMemory();
    await admit(reverse, eventGamma, OBSERVED_AT_C);
    await admit(reverse, eventBeta, OBSERVED_AT_B);
    await admit(reverse, eventAlpha, OBSERVED_AT_A);

    const rotated = createFailureMemory();
    await admit(rotated, eventBeta, OBSERVED_AT_B);
    await admit(rotated, eventGamma, OBSERVED_AT_C);
    await admit(rotated, eventAlpha, OBSERVED_AT_A);

    const forwardSnapshot = await forward.snapshot();
    expect(await reverse.snapshot()).toBe(forwardSnapshot);
    expect(await rotated.snapshot()).toBe(forwardSnapshot);
    expect(reverse.list()).toEqual(forward.list());
    expect(rotated.list()).toEqual(forward.list());
    expect(forward.size()).toBe(3);
    expect(reverse.size()).toBe(3);
    expect(rotated.size()).toBe(3);
  });

  test('malformed findings, repairs, or options fail closed with named errors — never an exception', async () => {
    const memory = createFailureMemory();
    const base = failureEvent({
      finding: diffFinding({ id: 'diff_bad', expected: 'ok', actual: 'missing' }),
      packageRef: packageRef('a1'),
      target: 'bench/b01-static',
      context: 'paired replay of journey j01, step 0',
    });

    // A bad dimension (outside the frozen vocabulary).
    const badDimension = await memory.record(
      { ...base, finding: { ...base.finding, dimension: 'performance' } },
      { observedAt: OBSERVED_AT_A },
    );
    expect(badDimension.ok).toBe(false);
    if (!badDimension.ok) {
      expect(badDimension.errors.some((error) => error.includes('dimension'))).toBe(true);
    }

    // A bad severity (outside the frozen vocabulary).
    const badSeverity = await memory.record(
      { ...base, finding: { ...base.finding, severity: 'fatal' } },
      { observedAt: OBSERVED_AT_A },
    );
    expect(badSeverity.ok).toBe(false);
    if (!badSeverity.ok) {
      expect(badSeverity.errors.some((error) => error.includes('severity'))).toBe(true);
    }

    // A non-boolean attempted.
    const badAttempted = await memory.record(
      { ...base, repair: { ...base.repair, attempted: 'yes' } },
      { observedAt: OBSERVED_AT_A },
    );
    expect(badAttempted.ok).toBe(false);
    if (!badAttempted.ok) {
      expect(badAttempted.errors.some((error) => error.includes('attempted'))).toBe(true);
    }

    // A non-RFC3339 observedAt — including the rollover date 2026-02-30,
    // which Date.parse silently accepts and the calendar-valid check
    // refuses.
    for (const observedAt of ['not-a-timestamp', '2026-02-30T00:00:00Z']) {
      const badTime = await memory.record(base, { observedAt });
      expect(badTime.ok).toBe(false);
      if (!badTime.ok) {
        expect(badTime.errors.some((error) => error.includes('observedAt'))).toBe(true);
      }
    }

    // A missing target.
    const badTarget = await memory.record({ ...base, target: '' }, { observedAt: OBSERVED_AT_A });
    expect(badTarget.ok).toBe(false);
    if (!badTarget.ok) {
      expect(badTarget.errors.some((error) => error.includes('target'))).toBe(true);
    }

    // Two bad fields at once — EVERY error is collected, never just the first.
    const twoBad = await memory.record(
      { ...base, finding: { ...base.finding, severity: 'fatal' }, context: '' },
      { observedAt: OBSERVED_AT_A },
    );
    expect(twoBad.ok).toBe(false);
    if (!twoBad.ok) {
      expect(twoBad.errors.some((error) => error.includes('severity'))).toBe(true);
      expect(twoBad.errors.some((error) => error.includes('context'))).toBe(true);
    }

    // Fail closed: nothing above was stored — and no call threw (every
    // await resolving is itself the never-an-exception proof).
    expect(memory.size()).toBe(0);
    expect(memory.list()).toEqual([]);
  });

  test('event ids are content-addressed — duplicates are refused, recurrences are distinct', async () => {
    const memory = createFailureMemory();

    const first = await admit(memory, eventAlpha, OBSERVED_AT_A);
    expect(first.id).toMatch(/^fail_[0-9a-f]{64}$/);
    expect(first.failureVersion).toBe(FAILURE_VERSION);

    // The exact same event again: same content → same id → refused, named.
    const duplicate = await memory.record(eventAlpha, { observedAt: OBSERVED_AT_A });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(
        duplicate.errors.some(
          (error) =>
            error.includes('duplicate failure event') &&
            error.includes(first.id) &&
            error.includes(eventAlpha.finding.id) &&
            error.includes(OBSERVED_AT_A),
        ),
      ).toBe(true);
    }
    expect(memory.size()).toBe(1); // the refusal stored nothing

    // The same finding re-observed at a DIFFERENT observedAt: a distinct event.
    const recurrence = await admit(memory, eventAlpha, OBSERVED_AT_B);
    expect(recurrence.id).not.toBe(first.id);
    expect(memory.size()).toBe(2);

    // The same signature from a DIFFERENT finding id (a re-run mints fresh
    // finding ids for the same divergence): a distinct event too.
    const sibling = await admit(
      memory,
      failureEvent({
        finding: diffFinding({
          id: 'diff_epsilon',
          dimension: 'semantic',
          severity: 'critical',
          summary: LOGIN_SUMMARY,
          expected: { status: 200 },
          actual: { status: 401 },
        }),
        packageRef: packageRef('a1'),
        target: 'bench/b01-static',
        context: 'paired replay of journey j01, step 2',
      }),
      OBSERVED_AT_A,
    );
    expect(sibling.id).not.toBe(first.id);
    expect(sibling.id).not.toBe(recurrence.id);
    expect(memory.size()).toBe(3);

    // Three distinct ids for the three stored events (measured).
    expect(new Set([first.id, recurrence.id, sibling.id]).size).toBe(3);
  });

  test('failure records derive their signature honestly from the frozen vocabulary', async () => {
    const memory = createFailureMemory();

    const finding = diffFinding({
      id: 'diff_signature',
      dimension: 'network',
      severity: 'major',
      summary: 'The mock API returns the wrong response shape.',
      expected: { items: 2 },
      actual: { items: 0 },
    });
    const repair = repairFacts({
      attempted: true,
      resolved: true,
      resolvedFindingIds: ['diff_zeta', 'diff_alpha', 'diff_zeta'], // unsorted, duplicated
      generalized: false,
    });
    const packageReference = packageRef('d4');
    const record = await admit(
      memory,
      {
        finding,
        repair,
        packageRef: packageReference,
        target: 'bench/b02-dashboard',
        context: 'paired replay of journey j02, step 4',
      },
      OBSERVED_AT_A,
    );

    // The signature carries the finding's frozen vocabulary VERBATIM.
    expect(record.signature).toEqual({
      dimension: 'network',
      severity: 'major',
      findingId: 'diff_signature',
      summary: 'The mock API returns the wrong response shape.',
    });
    expect(record.signature.dimension).toBe(finding.dimension);
    expect(record.signature.severity).toBe(finding.severity);
    expect(record.signature.findingId).toBe(finding.id);
    expect(record.signature.summary).toBe(finding.summary);

    // expected/actual carried VERBATIM.
    expect(record.expected).toEqual({ items: 2 });
    expect(record.actual).toEqual({ items: 0 });

    // The repair facts: attempted/resolved/generalized verbatim; the
    // resolved ids sorted + deduped (in a FRESH array — the input is
    // never mutated).
    expect(record.repair.attempted).toBe(true);
    expect(record.repair.resolved).toBe(true);
    expect(record.repair.generalized).toBe(false);
    expect(record.repair.resolvedFindingIds).toEqual(['diff_alpha', 'diff_zeta']);
    expect(repair.resolvedFindingIds).toEqual(['diff_zeta', 'diff_alpha', 'diff_zeta']);

    // The verbatim carriers: packageRef, target, context, observedAt.
    expect(record.packageRef).toEqual(packageReference);
    expect(record.target).toBe('bench/b02-dashboard');
    expect(record.context).toBe('paired replay of journey j02, step 4');
    expect(record.observedAt).toBe(OBSERVED_AT_A);

    // A structural finding: absent expected/actual stay ABSENT on the record.
    const structuralRecord = await admit(
      memory,
      failureEvent({
        finding: diffFinding({
          id: 'diff_structural',
          dimension: 'visual',
          severity: 'minor',
          summary: 'A cosmetic layout divergence.',
        }),
      }),
      OBSERVED_AT_B,
    );
    expect('expected' in structuralRecord).toBe(false);
    expect('actual' in structuralRecord).toBe(false);
  });

  test('signature and package queries count honestly from the stored events', async () => {
    const memory = createFailureMemory();
    const alpha = await admit(memory, eventAlpha, OBSERVED_AT_A); // login signature, pkg a1
    const beta = await admit(memory, eventBeta, OBSERVED_AT_B); // login signature, pkg b2
    await admit(memory, eventGamma, OBSERVED_AT_C); // state signature, no package

    expect(memory.size()).toBe(3); // measured

    // Two of the three events share the login signature (measured: 2).
    const loginRecurrences = memory.bySignature({
      dimension: 'semantic',
      severity: 'critical',
      summary: LOGIN_SUMMARY,
    });
    expect(loginRecurrences.length).toBe(2);
    expect(loginRecurrences.map((record) => record.id).sort()).toEqual(
      [alpha.id, beta.id].sort(),
    );

    // The state signature has exactly one event; a miss returns [].
    expect(
      memory.bySignature({
        dimension: 'state',
        severity: 'minor',
        summary: 'A localStorage key diverges after login.',
      }).length,
    ).toBe(1);
    expect(
      memory.bySignature({
        dimension: 'visual',
        severity: 'info',
        summary: 'no such signature',
      }),
    ).toEqual([]);

    // Package queries: the right subsets; misses (and garbage) return [].
    expect(memory.byPackage(packageRef('a1').id).map((record) => record.id)).toEqual([alpha.id]);
    expect(memory.byPackage(packageRef('b2').id).map((record) => record.id)).toEqual([beta.id]);
    expect(memory.byPackage(`pkg_${'0'.repeat(64)}`)).toEqual([]);
    expect(memory.byPackage(42 as unknown as string)).toEqual([]);
    expect(
      memory.bySignature(null as unknown as { dimension: string; severity: string; summary: string }),
    ).toEqual([]);
  });

  test('listings are canonically ordered and defensively copied', async () => {
    // Learn each event's minted id from a scratch memory first, then admit
    // into the test memory in REVERSE sorted-id order — the insertions are
    // provably unsorted (the reverse of the canonical order, 4 distinct ids).
    const admissions = [
      { event: eventAlpha, at: OBSERVED_AT_A },
      { event: eventBeta, at: OBSERVED_AT_B },
      { event: eventGamma, at: OBSERVED_AT_C },
      { event: eventDelta, at: OBSERVED_AT_B },
    ];
    const scratch = createFailureMemory();
    const minted: Array<{ id: string; event: FailureEventInput; at: string }> = [];
    for (const admission of admissions) {
      const record = await admit(scratch, admission.event, admission.at);
      minted.push({ id: record.id, event: admission.event, at: admission.at });
    }
    const sorted = [...minted].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
    expect(new Set(sorted.map((entry) => entry.id)).size).toBe(4);

    const memory = createFailureMemory();
    for (const entry of [...sorted].reverse()) {
      await admit(memory, entry.event, entry.at);
    }

    const listing = memory.list();
    expect(listing.map((record) => record.id)).toEqual(sorted.map((entry) => entry.id));

    // Defensive copies: mutating returned records (and the listing array)
    // must not change the memory's subsequent listings.
    const first = listing[0];
    if (first === undefined) {
      throw new Error('listing must carry four records');
    }
    first.repair.resolvedFindingIds.push('diff_evil');
    if (first.packageRef !== null) {
      first.packageRef.id = 'pkg_evil';
    }
    const withObjectExpected = listing.find(
      (record) => typeof record.expected === 'object' && record.expected !== null,
    );
    if (withObjectExpected === undefined) {
      throw new Error('at least one listed event must carry an object expected');
    }
    (withObjectExpected.expected as Record<string, unknown>)['injected'] = true;
    listing.push({} as FailureRecord);

    const after = memory.list();
    expect(after.length).toBe(4);
    expect(after).toEqual(scratch.list()); // same events → the same deep listing
    expect(after[0]?.repair.resolvedFindingIds ?? []).not.toContain('diff_evil');
    expect(memory.size()).toBe(4);

    // The same seal covers the query listings.
    const recurrenceListing = memory.bySignature({
      dimension: 'semantic',
      severity: 'critical',
      summary: LOGIN_SUMMARY,
    });
    expect(recurrenceListing.length).toBe(2);
    recurrenceListing[0]?.repair.resolvedFindingIds.push('diff_evil');
    expect(
      memory.bySignature({
        dimension: 'semantic',
        severity: 'critical',
        summary: LOGIN_SUMMARY,
      }),
    ).toEqual(
      scratch.bySignature({
        dimension: 'semantic',
        severity: 'critical',
        summary: LOGIN_SUMMARY,
      }),
    );
  });

  test('the snapshot is content-addressed — any change moves it, and the empty memory is valid', async () => {
    const memory = createFailureMemory();

    // An honest empty memory has a valid snapshot.
    const empty = await memory.snapshot();
    expect(empty.startsWith('fmem_')).toBe(true);
    expect(empty.length).toBeGreaterThan('fmem_'.length);
    expect(await createFailureMemory().snapshot()).toBe(empty);

    // Each new event moves the digest.
    await admit(memory, eventAlpha, OBSERVED_AT_A);
    const one = await memory.snapshot();
    expect(one).not.toBe(empty);
    expect(one.startsWith('fmem_')).toBe(true);

    await admit(memory, eventBeta, OBSERVED_AT_B);
    const two = await memory.snapshot();
    expect(two).not.toBe(one);
    expect(two).not.toBe(empty);

    // The same set, rebuilt in a different admission order, yields the same digest.
    const rebuilt = createFailureMemory();
    await admit(rebuilt, eventBeta, OBSERVED_AT_B);
    await admit(rebuilt, eventAlpha, OBSERVED_AT_A);
    expect(await rebuilt.snapshot()).toBe(two);
    expect(rebuilt.list()).toEqual(memory.list());
  });

  test('the package imports only frozen contracts — no cross-implementation import', () => {
    const files = listTsFiles(SRC_ROOT).sort();
    // the five modules of the delivered surface
    expect(files.map((file) => file.slice(PACKAGE_ROOT.length + 1))).toEqual([
      'src/archetypes.ts',
      'src/composition.ts',
      'src/failure-memory.ts',
      'src/index.ts',
      'src/repair-patterns.ts',
    ]);
    const fixtureFiles = listTsFiles(FIXTURES_ROOT).sort();
    expect(fixtureFiles.map((file) => file.slice(PACKAGE_ROOT.length + 1))).toEqual([
      'test/fixtures/failure-fixtures.ts',
    ]);

    const violations: string[] = [];

    // src/**: @clapp/core + @clapp/library + @clapp/observe at RUNTIME
    // (CLAPP-063: the composition planner consumes the landed library
    // machinery live — retrievePackages + buildCompatGraph — so
    // @clapp/library moved from the contract set to the runtime set);
    // @clapp/diff + @clapp/repair for TYPES ONLY; nothing else.
    for (const file of files) {
      const display = file.slice(PACKAGE_ROOT.length + 1);
      const source = readFileSync(file, 'utf8');

      for (const { clause, specifier } of sourceImports(source)) {
        const contractPackage = CONTRACT_PACKAGES.find(
          (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
        );
        if (contractPackage !== undefined) {
          if (!clause.startsWith('type')) {
            violations.push(
              `${display}: RUNTIME import of ${contractPackage} (${JSON.stringify(specifier)}) — the contract owners are import-type ONLY`,
            );
          }
          continue;
        }
        if (specifier.startsWith('@clapp/')) {
          if (!RUNTIME_ALLOWED.has(specifier)) {
            violations.push(
              `${display}: undeclared workspace dependency ${JSON.stringify(specifier)} — the runtime dependency set is exactly @clapp/core + @clapp/library + @clapp/observe`,
            );
          }
          continue;
        }
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
          continue; // relative module or a runtime-provided builtin — not a package
        }
        violations.push(`${display}: non-workspace package import ${JSON.stringify(specifier)}`);
      }

      checkNoSideEffectImports(violations, display, source);
    }

    // test/fixtures/**: relative + node: builtins + the frozen contract
    // owners AND the runtime dependency set for TYPES ONLY (the fixtures
    // build contract-shaped literals; the runtime implementations stay
    // src-only). CLAPP-063: @clapp/library moved from the contract set to
    // the runtime set, so the 062 fixtures' PackageManifest TYPE-ONLY
    // import stays legal here through the runtime set's type-only rule —
    // the licensed consequence of the set move, keeping the fixtures scan
    // strict (a RUNTIME fixture import is still a violation).
    for (const file of fixtureFiles) {
      const display = file.slice(PACKAGE_ROOT.length + 1);
      const source = readFileSync(file, 'utf8');

      for (const { clause, specifier } of sourceImports(source)) {
        const contractPackage = CONTRACT_PACKAGES.find(
          (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
        );
        if (contractPackage !== undefined) {
          if (!clause.startsWith('type')) {
            violations.push(
              `${display}: RUNTIME import of ${contractPackage} (${JSON.stringify(specifier)}) — the fixtures import the contract owners for TYPES ONLY`,
            );
          }
          continue;
        }
        if (specifier.startsWith('@clapp/')) {
          if (RUNTIME_ALLOWED.has(specifier)) {
            if (!clause.startsWith('type')) {
              violations.push(
                `${display}: RUNTIME import of ${JSON.stringify(specifier)} — the fixtures import the workspace packages for TYPES ONLY`,
              );
            }
          } else {
            violations.push(
              `${display}: undeclared workspace dependency ${JSON.stringify(specifier)} — the fixtures import only the frozen contract types and the runtime set's types`,
            );
          }
          continue;
        }
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
          continue; // relative module or a runtime-provided builtin — not a package
        }
        violations.push(
          `${display}: unexpected import ${JSON.stringify(specifier)} — the fixtures import only the frozen contract types`,
        );
      }

      checkNoSideEffectImports(violations, display, source);
    }

    expect(violations).toEqual([]);
  });
});
