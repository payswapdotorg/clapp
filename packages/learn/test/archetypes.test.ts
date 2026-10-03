// CLAPP-062 — the archetype classifier tests (the W1 learning lane, the
// P6 third checkbox: "archetype detection").
//
// Fixtures: test/fixtures/failure-fixtures.ts (the APPENDED CLAPP-062
// section — manifest-shaped literals over the @clapp/library
// PackageManifest vocabulary, TYPE-ONLY). The eight named tests cover the
// packet's axes: determinism (including fact-order independence),
// fail-closed admission, the frozen five-rule table in canonical order
// with measured evidence, interface-sourced api evidence,
// tags-not-partition, the measured-absence static classification, the
// honest unclassified verdict, and content-addressed identities.

import { describe, expect, test } from 'bun:test';

import { ARCHETYPE_TABLE_VERSION, ARCHETYPE_VERSION, classifyManifest } from '../src/archetypes';
import type { ArchetypeClassification } from '../src/archetypes';
import { CLASSIFIED_AT_A, CLASSIFIED_AT_B, manifestShape } from './fixtures/failure-fixtures';

/** Classify and be loud about it — a fixture failure must not pass silently. */
async function classify(
  manifest: unknown,
  classifiedAt: string = CLASSIFIED_AT_A,
): Promise<ArchetypeClassification> {
  const result = await classifyManifest(manifest, { classifiedAt });
  if (!result.ok) {
    throw new Error(`classification failed: ${result.errors.join('; ')}`);
  }
  return result.classification;
}

describe('the archetype classifier (CLAPP-062)', () => {
  test('classification is deterministic — identical manifest and options produce identical classifications', async () => {
    const manifest = manifestShape({ capabilities: ['form', 'storage:localstorage'] });
    const first = await classifyManifest(manifest, { classifiedAt: CLASSIFIED_AT_A });
    const second = await classifyManifest(manifest, { classifiedAt: CLASSIFIED_AT_A });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.classification).toEqual(first.classification);
      expect(second.classification.id).toBe(first.classification.id);
      expect(first.classification.id).toMatch(/^arch_[0-9a-f]{64}$/);
    }

    // Fact-order independence (the 060/061 house law applied to the facts):
    // the SAME measured facts in a DIFFERENT input order classify
    // identically — the input order never leaks into the classification.
    const reordered = await classify(
      manifestShape({ capabilities: ['storage:localstorage', 'form'] }),
    );
    const again = await classify(manifest);
    expect(reordered).toEqual(again);
    expect(reordered.id).toBe(again.id);
  });

  test('malformed manifests or options fail closed with named errors — never an exception', async () => {
    const base = manifestShape({ capabilities: ['form'], interface: ['/about'] });

    // A non-object manifest (the options are validated first, so their
    // errors are still collected — ALL errors, never just the first).
    const notAnObject = await classifyManifest('not-a-manifest', {
      classifiedAt: CLASSIFIED_AT_A,
    });
    expect(notAnObject.ok).toBe(false);
    if (!notAnObject.ok) {
      expect(notAnObject.errors.some((error) => error.startsWith('manifest:'))).toBe(true);
    }

    // A non-array capabilities.
    const badCapabilities = await classifyManifest(
      { ...base, capabilities: 'form' as unknown as string[] },
      { classifiedAt: CLASSIFIED_AT_A },
    );
    expect(badCapabilities.ok).toBe(false);
    if (!badCapabilities.ok) {
      expect(badCapabilities.errors.some((error) => error.includes('manifest.capabilities'))).toBe(
        true,
      );
    }

    // A non-string manifest id.
    const badId = await classifyManifest(
      { ...base, id: 42 as unknown as string },
      { classifiedAt: CLASSIFIED_AT_A },
    );
    expect(badId.ok).toBe(false);
    if (!badId.ok) {
      expect(badId.errors.some((error) => error.includes('manifest.id'))).toBe(true);
    }

    // A non-RFC3339 classifiedAt — including the rollover date 2026-02-30,
    // which Date.parse silently accepts and the calendar-valid check
    // refuses.
    for (const classifiedAt of ['not-a-timestamp', '2026-02-30T00:00:00Z']) {
      const badTime = await classifyManifest(base, { classifiedAt });
      expect(badTime.ok).toBe(false);
      if (!badTime.ok) {
        expect(badTime.errors.some((error) => error.includes('options.classifiedAt'))).toBe(true);
      }
    }

    // A non-object options.
    const badOptions = await classifyManifest(base, null);
    expect(badOptions.ok).toBe(false);
    if (!badOptions.ok) {
      expect(badOptions.errors.some((error) => error.startsWith('options:'))).toBe(true);
    }

    // Two bad fields at once — EVERY error is collected, never just the first.
    const twoBad = await classifyManifest(
      { ...base, id: 42 as unknown as string },
      { classifiedAt: '2026-02-30T00:00:00Z' },
    );
    expect(twoBad.ok).toBe(false);
    if (!twoBad.ok) {
      expect(twoBad.errors.some((error) => error.includes('manifest.id'))).toBe(true);
      expect(twoBad.errors.some((error) => error.includes('options.classifiedAt'))).toBe(true);
    }

    // Fail closed, proven: every call above RESOLVED (never threw) and
    // returned { ok: false } — the awaits resolving are themselves the
    // never-an-exception proof.
  });

  test('the five-rule table is evaluated in canonical order with measured evidence', async () => {
    // form + storage — deliberately UNSORTED input: the evidence is
    // measured (sorted, fresh) and the matches land in the TABLE's
    // canonical order (rule 2 before rule 3), not the input's.
    const classification = await classify(
      manifestShape({ capabilities: ['storage:localstorage', 'form'], interface: ['/'] }),
    );
    expect(classification.archetypeVersion).toBe(ARCHETYPE_VERSION);
    expect(classification.tableVersion).toBe(ARCHETYPE_TABLE_VERSION);
    expect(classification.outcome).toBe('classified');
    expect(classification.matches.map((match) => match.name)).toEqual([
      'form-driven-app',
      'persistent-app',
    ]);

    const form = classification.matches[0];
    if (form === undefined) {
      throw new Error('the form-driven-app match must be first (table order)');
    }
    expect(form.matchedCapabilities).toEqual(['form']);
    expect(form.matchedInterface).toEqual([]);
    expect(form.reasons).toEqual([`capabilities includes 'form'`]);

    const persistent = classification.matches[1];
    if (persistent === undefined) {
      throw new Error('the persistent-app match must be second (table order)');
    }
    expect(persistent.matchedCapabilities).toEqual(['storage:localstorage']);
    expect(persistent.matchedInterface).toEqual([]);
    expect(persistent.reasons.some((reason) => reason.includes("'storage:localstorage'"))).toBe(
      true,
    );
  });

  test("api evidence may come from the interface — '/api/'-prefixed entries are measured facts", async () => {
    // capabilities WITHOUT 'api-mock'; the interface carries '/api/users'
    // and a non-api route. ('route' alone satisfies no rule, so the ONLY
    // match is the interface-sourced api-backed-app — its capability
    // evidence is empty, honestly.)
    const classification = await classify(
      manifestShape({ capabilities: ['route'], interface: ['/about', '/api/users'] }),
    );
    expect(classification.matches.map((match) => match.name)).toEqual(['api-backed-app']);

    const api = classification.matches[0];
    if (api === undefined) {
      throw new Error('the api-backed-app match must exist');
    }
    expect(api.matchedInterface).toEqual(['/api/users']);
    expect(api.matchedCapabilities).toEqual([]);
    expect(api.reasons.some((reason) => reason.includes("'/api/users'"))).toBe(true);
  });

  test('archetypes are tags not a partition — multiple matches all land', async () => {
    // form + storage + navigation + route + api-mock (plus api interface
    // entries, deliberately unsorted): ALL of rules 1–4 match, in table
    // order; rule 5 does not (capabilities is non-empty).
    const classification = await classify(
      manifestShape({
        capabilities: ['navigation', 'storage:memory', 'form', 'api-mock', 'route'],
        interface: ['/api/zeta', '/api/alpha', '/about'],
      }),
    );
    expect(classification.outcome).toBe('classified');
    expect(classification.matches.map((match) => match.name)).toEqual([
      'api-backed-app',
      'form-driven-app',
      'persistent-app',
      'navigable-app',
    ]);

    // Rule 1's evidence, measured from BOTH surfaces: the 'api-mock'
    // capability AND the interface's '/api/'-prefixed entries (sorted —
    // the input order never leaks).
    const api = classification.matches[0];
    if (api === undefined) {
      throw new Error('the api-backed-app match must be first (table order)');
    }
    expect(api.matchedCapabilities).toEqual(['api-mock']);
    expect(api.matchedInterface).toEqual(['/api/alpha', '/api/zeta']);

    // Rule 4's evidence: BOTH required capabilities, sorted.
    const navigable = classification.matches[3];
    if (navigable === undefined) {
      throw new Error('the navigable-app match must be fourth (table order)');
    }
    expect(navigable.matchedCapabilities).toEqual(['navigation', 'route']);
  });

  test('empty capabilities classify as static-content-app — a measured absence, not a guess', async () => {
    // capabilities [] with routes in the interface: an interface-only
    // manifest — routes may exist; no behavioral capability.
    const classification = await classify(
      manifestShape({ capabilities: [], interface: ['/about', '/'] }),
    );
    expect(classification.outcome).toBe('classified');
    expect(classification.matches.map((match) => match.name)).toEqual(['static-content-app']);

    const match = classification.matches[0];
    if (match === undefined) {
      throw new Error('the static-content-app match must exist');
    }
    expect(match.matchedCapabilities).toEqual([]);
    expect(match.matchedInterface).toEqual([]);
    // The reason names the MEASURED emptiness (not a guessed archetype).
    expect(match.reasons.some((reason) => reason.includes('capabilities is empty'))).toBe(true);
  });

  test('unclassified is honest — non-empty capabilities satisfying no rule', async () => {
    // capabilities ['route'] only: non-empty (rule 5 does not fire), and
    // 'route' alone satisfies no rule (rule 4 needs BOTH route AND
    // navigation). The honest verdict is 'unclassified' — never a guess.
    const classification = await classify(manifestShape({ capabilities: ['route'] }));
    expect(classification.outcome).toBe('unclassified');
    expect(classification.matches).toEqual([]);
    // The reason names the unclaimed capability (measured).
    expect(
      classification.reasons.some(
        (reason) => reason.includes("'route'") && reason.includes('unclaimed'),
      ),
    ).toBe(true);
  });

  test('classification ids are content-addressed — any fact change moves the id', async () => {
    const baseline = await classify(manifestShape({ capabilities: ['form', 'storage:memory'] }));
    expect(baseline.id).toMatch(/^arch_[0-9a-f]{64}$/);

    // ONE capability added — a new measured fact, a new match, and a NEW id.
    const changed = await classify(
      manifestShape({ capabilities: ['api-mock', 'form', 'storage:memory'] }),
    );
    expect(changed.id).not.toBe(baseline.id);

    // The unchanged rules' matches stay byte-stable (identical measured
    // evidence and reasons — the id moved because the WHOLE
    // classification moved, not because the surviving matches changed).
    expect(changed.matches.find((match) => match.name === 'form-driven-app')).toEqual(
      baseline.matches.find((match) => match.name === 'form-driven-app'),
    );
    expect(changed.matches.find((match) => match.name === 'persistent-app')).toEqual(
      baseline.matches.find((match) => match.name === 'persistent-app'),
    );

    // Any OTHER fact change moves the id too: the caller-injected clock is
    // part of the classification's content.
    const reclassified = await classify(
      manifestShape({ capabilities: ['form', 'storage:memory'] }),
      CLASSIFIED_AT_B,
    );
    expect(reclassified.id).not.toBe(baseline.id);
  });
});
