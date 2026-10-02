// CLAPP-052 — the retrieval tests: determinism (identical inputs, any
// manifest input order, canonical digests), fail-closed validation
// (malformed manifests AND queries — never an exception, every error
// named), the candidacy gate (target mismatch + partial coverage excluded
// honestly, with measured per-exclusion reasons), the frozen composite
// ranking (each signal recomputed INDEPENDENTLY from the fixture facts and
// fed through the frozen formula — bit-exact — with a real score TIE
// broken by id ASC), the lexical similarity placeholder (exact Jaccard
// values, token-set semantics, measured-not-semantic), parity history +
// repair cost (raw list lengths, capped in the formula only), optional
// capabilities + maxResults (weighting never gating; truncation applied
// AFTER ranking and reported honestly), and satisfiability (every required
// capability set satisfiable from the fixture corpus or reported empty
// with reasons).

import { describe, expect, test } from 'bun:test';
import { retrievePackages } from '../src/retrieval';
import type { RetrieveResult, RetrievalResult, RetrievalScoreComponents } from '../src/retrieval';
import type { PackageManifest } from '../src/package-contract';
import { retrievalCorpus, retrievalManifest } from './fixtures/retrieval-manifests';

/** Fail loudly (with the honest errors) if a retrieval did not succeed. */
function requireResult(outcome: RetrieveResult): RetrievalResult {
  if (!outcome.ok) {
    throw new Error(`expected a retrieval result, got fail-closed errors: ${outcome.errors.join('; ')}`);
  }
  return outcome.result;
}

/** The observed outcome of a call — a rejection (if any) is DATA, never a crash. */
type Observed =
  | { threw: false; value: RetrieveResult }
  | { threw: true; error: unknown };

async function observeOutcome(manifests: unknown, query: unknown): Promise<Observed> {
  return retrievePackages(manifests, query).then(
    (value): Observed => ({ threw: false, value }),
    (error: unknown): Observed => ({ threw: true, error }),
  );
}

/** The query shape the tests pass (a structural subset of RetrievalQuery). */
interface QueryShape {
  target: string;
  requiredCapabilities: string[];
  optionalCapabilities?: string[];
  purposeHint?: string;
  maxResults?: number;
}

/**
 * INDEPENDENT signal recomputation — from the FIXTURE manifests and query
 * only, never from the retrieval's own output. This is the oracle the
 * ranking test feeds through the frozen formula.
 */
function expectedComponents(
  manifests: PackageManifest[],
  manifest: PackageManifest,
  query: QueryShape,
): RetrievalScoreComponents {
  const required = [...new Set(query.requiredCapabilities)];
  const optional = query.optionalCapabilities === undefined ? [] : [...new Set(query.optionalCapabilities)];
  const requiredMatched = required.filter((capability) => manifest.capabilities.includes(capability));
  const optionalMatched = optional.filter((capability) => manifest.capabilities.includes(capability));

  const hintTokens = new Set(
    query.purposeHint === undefined
      ? []
      : query.purposeHint.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0),
  );
  const purposeTokens = new Set(
    manifest.purpose.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0),
  );
  let similarity = 0;
  if (hintTokens.size > 0 && purposeTokens.size > 0) {
    const intersection = [...hintTokens].filter((token) => purposeTokens.has(token)).length;
    const union = hintTokens.size + purposeTokens.size - intersection;
    similarity = intersection / union;
  }

  const recencyOrder = [...manifests].sort((left, right) => {
    if (left.generatedAt !== right.generatedAt) {
      return left.generatedAt > right.generatedAt ? -1 : 1; // generatedAt DESC
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0; // id ASC tie-break
  });
  const recencyRank = recencyOrder.findIndex((entry) => entry.id === manifest.id);

  return {
    targetMatch: manifest.supportedTargets.includes(query.target),
    requiredCoverage: required.length === 0 ? 1 : requiredMatched.length / required.length,
    optionalCoverage: optional.length === 0 ? 0 : optionalMatched.length / optional.length,
    similarity,
    parityHistory: manifest.evidence.length,
    repairCost: manifest.failureModes.length,
    recencyRank,
  };
}

/** The FROZEN composite, verbatim from the work order — the score oracle. */
function expectedScore(components: RetrievalScoreComponents): number {
  return (
    40 * components.requiredCoverage +
    15 * components.optionalCoverage +
    15 * components.similarity +
    (10 * Math.min(components.parityHistory, 5)) / 5 -
    (6 * Math.min(components.repairCost, 5)) / 5 +
    6 * (1 / (1 + components.recencyRank))
  );
}

/** Find a scored candidate by manifest id (ranking order is the test subject). */
function candidateById(result: RetrievalResult, id: string) {
  const found = result.candidates.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`expected a candidate for ${id}, got: ${result.candidates.map((entry) => entry.id).join(', ')}`);
  }
  return found;
}

describe('determinism', () => {
  test('retrieval is deterministic — identical inputs rank identically with a stable digest', async () => {
    const corpus = retrievalCorpus();
    const query: QueryShape = {
      target: 'web',
      requiredCapabilities: ['form', 'route'],
      purposeHint: 'a web form and route application',
    };

    const first = requireResult(await retrievePackages(corpus, query));
    const second = requireResult(await retrievePackages(corpus, query));

    // identical inputs → deep-equal result (candidates, counts, reasons, digest)
    expect(second).toEqual(first);
    expect(second.queryDigest).toBe(first.queryDigest);
    expect(first.retrievalVersion).toBe('0.1');
    // the query identity is content-addressed, rq_-prefixed, 64 lowercase hex
    expect(first.queryDigest).toMatch(/^rq_[0-9a-f]{64}$/);

    // ANY manifest input order → the same retrieval (ranking is canonical)
    const permuted = requireResult(
      await retrievePackages([corpus[4]!, corpus[1]!, corpus[3]!, corpus[0]!, corpus[2]!], query),
    );
    expect(permuted).toEqual(first);

    // capability array ORDER is presentation, not semantics — the normalized
    // query canonicalizes (sorted, deduped), so the digest is stable
    const reordered = requireResult(
      await retrievePackages(corpus, { ...query, requiredCapabilities: ['route', 'form'] }),
    );
    expect(reordered).toEqual(first);
    expect(reordered.queryDigest).toBe(first.queryDigest);

    // stability is not insensitivity: a different query mints a different digest
    const different = requireResult(await retrievePackages(corpus, { ...query, target: 'desktop' }));
    expect(different.queryDigest).not.toBe(first.queryDigest);
  });
});

describe('fail-closed validation', () => {
  test('malformed manifests or queries fail closed with named errors — never an exception', async () => {
    const validQuery = { target: 'web', requiredCapabilities: [] };

    // ---- malformed MANIFESTS: every entry's errors collected, each naming
    //      the offending index AND field ----
    const badVersion = retrievalManifest({ idSeed: 'm1', overrides: { packageVersion: '9.9' } });
    const unsortedCapabilities = retrievalManifest({
      idSeed: 'm2',
      overrides: { capabilities: ['form', 'api-mock'] }, // 'form' > 'api-mock' — not canonical order
    });

    const manifestOutcome = await observeOutcome([badVersion, unsortedCapabilities], validQuery);
    expect(manifestOutcome.threw).toBe(false);
    const manifestResult = manifestOutcome.value;
    expect(manifestResult.ok).toBe(false);
    if (manifestResult.ok) throw new Error('expected fail-closed errors');
    expect(manifestResult.errors.length).toBeGreaterThanOrEqual(2);
    expect(
      manifestResult.errors.some((error) => error.includes('manifests[0]') && error.includes('packageVersion')),
    ).toBe(true);
    expect(
      manifestResult.errors.some((error) => error.includes('manifests[1]') && error.includes('capabilities')),
    ).toBe(true);

    // ---- a non-array manifest list is refused by name ----
    const notAnArray = await observeOutcome({ not: 'an array' }, validQuery);
    expect(notAnArray.threw).toBe(false);
    expect(notAnArray.value.ok).toBe(false);
    if (notAnArray.value.ok) throw new Error('expected fail-closed errors');
    expect(notAnArray.value.errors[0]).toContain('manifests: expected an array');

    // ---- duplicate minted ids (individually valid manifests) — the same
    //      discipline as the compat graph: ranking one package twice would
    //      be dishonest counting ----
    const once = retrievalManifest({ idSeed: 'a1', capabilities: ['route'] });
    const twice = retrievalManifest({ idSeed: 'a1', capabilities: ['navigation'] }); // SAME minted id
    const duplicate = await observeOutcome([once, twice], validQuery);
    expect(duplicate.threw).toBe(false);
    expect(duplicate.value.ok).toBe(false);
    if (duplicate.value.ok) throw new Error('expected fail-closed errors');
    expect(duplicate.value.errors).toHaveLength(1);
    expect(duplicate.value.errors[0]).toContain(`duplicate package id ${once.id}`);
    expect(duplicate.value.errors[0]).toContain('at indexes 0 and 1');

    // ---- malformed QUERIES: the v0.1 vocabulary, typo-safe, all errors named ----
    const malformedQueries: Array<{ query: unknown; names: string[] }> = [
      { query: null, names: ['query: expected an object'] },
      { query: 'web', names: ['query: expected an object'] },
      { query: ['web'], names: ['query: expected an object'] },
      { query: {}, names: ['query.target', 'query.requiredCapabilities'] },
      { query: { target: '', requiredCapabilities: [] }, names: ['query.target'] },
      { query: { target: 'web' }, names: ['query.requiredCapabilities'] },
      { query: { target: 'web', requiredCapabilities: 'form' }, names: ['query.requiredCapabilities'] },
      { query: { target: 'web', requiredCapabilities: ['form', 42] }, names: ['query.requiredCapabilities[1]'] },
      { query: { target: 'web', requiredCapabilities: [], optionalCapabilities: null }, names: ['query.optionalCapabilities'] },
      { query: { target: 'web', requiredCapabilities: [], purposeHint: 42 }, names: ['query.purposeHint'] },
      { query: { target: 'web', requiredCapabilities: [], maxResults: 0 }, names: ['query.maxResults'] },
      { query: { target: 'web', requiredCapabilities: [], maxResults: -1 }, names: ['query.maxResults'] },
      { query: { target: 'web', requiredCapabilities: [], maxResults: 1.5 }, names: ['query.maxResults'] },
      { query: { target: 'web', requiredCapabilities: [], maxResults: '3' }, names: ['query.maxResults'] },
      { query: { target: 'web', requiredCapabilities: [], reqquiredCapabilities: ['form'] }, names: ['unknown field'] },
    ];

    for (const { query, names } of malformedQueries) {
      // never an exception: the rejection (if any) is observed explicitly
      const outcome = await observeOutcome(retrievalCorpus(), query);
      expect(outcome.threw).toBe(false);
      const result = outcome.value;
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`expected fail-closed errors for query ${JSON.stringify(query)}`);
      for (const name of names) {
        expect(
          result.errors.some((error) => error.includes(name)),
          `expected an error naming ${name} for query ${JSON.stringify(query)}, got: ${result.errors.join('; ')}`,
        ).toBe(true);
      }
    }

    // ---- ALL errors collected across BOTH validation stages at once ----
    const combined = await observeOutcome([badVersion], { target: '', requiredCapabilities: [] });
    expect(combined.threw).toBe(false);
    expect(combined.value.ok).toBe(false);
    if (combined.value.ok) throw new Error('expected fail-closed errors');
    expect(combined.value.errors.some((error) => error.includes('manifests[0]'))).toBe(true);
    expect(combined.value.errors.some((error) => error.includes('query.target'))).toBe(true);
  });
});

describe('the candidacy gate', () => {
  test('the candidacy gate excludes target mismatches and partial capability matches honestly', async () => {
    const full = retrievalManifest({
      idSeed: 'a1',
      capabilities: ['form', 'route'],
      generatedAt: '2026-10-04T00:00:00Z',
    });
    const partial = retrievalManifest({
      idSeed: 'b2',
      capabilities: ['form'], // 1 of 2 required — partial coverage is NOT candidacy
      generatedAt: '2026-10-03T00:00:00Z',
    });
    const disjoint = retrievalManifest({
      idSeed: 'c3',
      capabilities: ['navigation'], // 0 of 2 required
      generatedAt: '2026-10-02T00:00:00Z',
    });
    const wrongTarget = retrievalManifest({
      idSeed: 'd4',
      capabilities: ['form', 'route'], // full coverage, WRONG target
      supportedTargets: ['desktop'],
      generatedAt: '2026-10-01T00:00:00Z',
    });
    const corpus = [full, partial, disjoint, wrongTarget];

    const result = requireResult(
      await retrievePackages(corpus, { target: 'web', requiredCapabilities: ['form', 'route'] }),
    );

    // measured counting: 4 considered, 3 excluded by the gate, 1 candidate
    expect(result.considered).toBe(4);
    expect(result.excluded).toBe(3);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([full.id]);
    expect(result.candidates[0]!.components.targetMatch).toBe(true);
    expect(result.candidates[0]!.components.requiredCoverage).toBe(1);

    // honesty: every exclusion is NAMED with its measured fact
    expect(
      result.reasons.some(
        (reason) => reason.includes(partial.id) && reason.includes('coverage 1 of 2') && reason.includes('"route"'),
      ),
    ).toBe(true);
    expect(result.reasons.some((reason) => reason.includes(disjoint.id) && reason.includes('coverage 0 of 2'))).toBe(true);
    expect(
      result.reasons.some((reason) => reason.includes(wrongTarget.id) && reason.includes('not among the measured supportedTargets')),
    ).toBe(true);
    expect(result.reasons.some((reason) => reason.includes('excluded 3 manifests by the candidacy gate'))).toBe(true);

    // the empty required set — every target-matching manifest is a candidate
    // (coverage vacuously complete), the target gate still applies
    const vacuous = requireResult(await retrievePackages(corpus, { target: 'web', requiredCapabilities: [] }));
    expect(vacuous.candidates.map((candidate) => candidate.id).sort()).toEqual(
      [full.id, partial.id, disjoint.id].sort(),
    );
    expect(vacuous.candidates.every((candidate) => candidate.components.requiredCoverage === 1)).toBe(true);
    expect(vacuous.excluded).toBe(1); // only the target mismatch
    expect(vacuous.candidates.every((candidate) => candidate.id !== wrongTarget.id)).toBe(true);
  });
});

describe('the frozen composite ranking', () => {
  test('ranking follows the frozen composite with deterministic tie-breaks', async () => {
    // The tie construction (bit-exact, verified): alpha and beta BOTH score
    // 46 — alpha via recency rank 0 (+6) with 0 of 5 optional capabilities,
    // beta via recency rank 1 (+3) with exactly 1 of 5 optional (+3) — so
    // the ordering between them is PROVABLY the id-ASC tie-break, never a
    // score difference. delta outranks both; gamma trails.
    const alpha = retrievalManifest({
      idSeed: 'a1',
      capabilities: ['form'],
      generatedAt: '2026-10-05T00:00:00Z', // recency rank 0
    });
    const beta = retrievalManifest({
      idSeed: 'b2',
      capabilities: ['beta-form', 'form'], // matches 1 of the 5 optional
      generatedAt: '2026-10-04T00:00:00Z', // recency rank 1
    });
    const gamma = retrievalManifest({
      idSeed: 'c3',
      capabilities: ['form'],
      generatedAt: '2026-10-03T00:00:00Z', // recency rank 2
    });
    const delta = retrievalManifest({
      idSeed: 'd4',
      capabilities: ['delta-only', 'epsilon-only', 'form', 'gamma-only'], // 3 of 5 optional
      evidenceCount: 5, // max parity weight
      generatedAt: '2026-10-02T00:00:00Z', // recency rank 3
    });
    const corpus = [alpha, beta, gamma, delta];
    const query: QueryShape = {
      target: 'web',
      requiredCapabilities: ['form'],
      optionalCapabilities: ['alpha-only', 'beta-form', 'gamma-only', 'delta-only', 'epsilon-only'],
    };

    const result = requireResult(await retrievePackages(corpus, query));

    // ---- every component AND score recomputed independently from the
    //      fixture facts, fed through the frozen formula — bit-exact ----
    const expected = new Map(
      corpus.map((manifest) => [manifest.id, expectedComponents(corpus, manifest, query)]),
    );
    for (const candidate of result.candidates) {
      const components = expected.get(candidate.id);
      if (components === undefined) throw new Error(`unexpected candidate ${candidate.id}`);
      expect(candidate.components).toEqual(components);
      expect(candidate.score).toBe(expectedScore(components));
    }

    // ---- the measured tie: both 46, exactly — then id ASC decides ----
    expect(expectedScore(expected.get(alpha.id)!)).toBe(46);
    expect(expectedScore(expected.get(beta.id)!)).toBe(46);
    expect(alpha.id < beta.id).toBe(true);

    // ---- the canonical order: score DESC, id ASC on ties ----
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([delta.id, alpha.id, beta.id, gamma.id]);
    expect(result.candidates[0]!.score).toBeGreaterThan(result.candidates[1]!.score); // 60.5 > 46
    expect(result.candidates[1]!.score).toBe(result.candidates[2]!.score); // the 46 tie
    expect(result.candidates[2]!.score).toBeGreaterThan(result.candidates[3]!.score); // 46 > ~42

    // measured counting: all four passed the gate
    expect(result.considered).toBe(4);
    expect(result.excluded).toBe(0);
  });
});

describe('the similarity signal', () => {
  test('the similarity signal is the documented lexical placeholder — measured, not semantic', async () => {
    // Token counts (measured by hand from the fixture texts — the oracle):
    //   hint 'form route banner'                 → {form, route, banner}                    (3)
    //   a1 'A web app with form and route surfaces.' → 8 tokens, ∩ 2 (form, route), ∪ 9 → 2/9
    //   b2 'Form Route Banner'                   → same token set as the hint            → 1
    //   c3 'Completely different words about storage.' → 5 tokens, ∩ 0                  → 0
    //   d4 'banner route form with extras'       → 5 tokens, ∩ 3, ∪ 5                    → 3/5
    //   e5 'input field and pageflow transitions' → semantically ADJACENT, ∩ 0 tokens   → 0
    const hint = 'form route banner';
    const similar = retrievalManifest({ idSeed: 'a1', purpose: 'A web app with form and route surfaces.' });
    const identical = retrievalManifest({ idSeed: 'b2', purpose: 'Form Route Banner' });
    const disjoint = retrievalManifest({ idSeed: 'c3', purpose: 'Completely different words about storage.' });
    const permuted = retrievalManifest({ idSeed: 'd4', purpose: 'banner route form with extras' });
    const semantic = retrievalManifest({ idSeed: 'e5', purpose: 'input field and pageflow transitions' });
    const corpus = [similar, identical, disjoint, permuted, semantic];

    const result = requireResult(
      await retrievePackages(corpus, { target: 'web', requiredCapabilities: [], purposeHint: hint }),
    );

    // exact measured Jaccard values (hard-coded from the counted tokens)
    expect(candidateById(result, similar.id).components.similarity).toBe(2 / 9);
    expect(candidateById(result, identical.id).components.similarity).toBe(1);
    expect(candidateById(result, disjoint.id).components.similarity).toBe(0);
    // token-SET semantics: word order contributes nothing
    expect(candidateById(result, permuted.id).components.similarity).toBe(3 / 5);
    // MEASURED, NOT SEMANTIC: the semantically adjacent purpose scores
    // exactly like the disjoint one — zero token overlap is zero similarity
    expect(candidateById(result, semantic.id).components.similarity).toBe(0);
    expect(candidateById(result, semantic.id).components.similarity).toBe(
      candidateById(result, disjoint.id).components.similarity,
    );

    // the measured value is reported in the candidate's own reasons
    expect(
      candidateById(result, similar.id).reasons.some((reason) =>
        reason.includes(`similarity ${String(2 / 9)} measured`),
      ),
    ).toBe(true);
    expect(
      candidateById(result, similar.id).reasons.some((reason) => reason.includes('not semantic')),
    ).toBe(true);

    // no purpose hint in the query → similarity 0 for every candidate
    // (nothing to compare — never a fabricated midpoint)
    const hintless = requireResult(
      await retrievePackages(corpus, { target: 'web', requiredCapabilities: [] }),
    );
    expect(hintless.candidates.every((candidate) => candidate.components.similarity === 0)).toBe(true);
    expect(
      hintless.candidates.every((candidate) =>
        candidate.reasons.some((reason) => reason.includes('no purpose hint in the query')),
      ),
    ).toBe(true);
  });
});

describe('parity history and repair cost', () => {
  test('parity history and repair cost are measured from the manifest', async () => {
    const none = retrievalManifest({ idSeed: 'a1', evidenceCount: 0, failureModeCount: 0 });
    const some = retrievalManifest({ idSeed: 'b2', evidenceCount: 2, failureModeCount: 3 });
    const capped = retrievalManifest({ idSeed: 'c3', evidenceCount: 7, failureModeCount: 9 });
    const corpus = [none, some, capped];

    const result = requireResult(
      await retrievePackages(corpus, { target: 'web', requiredCapabilities: [] }),
    );

    // the components report the RAW measured list lengths (never the caps)
    for (const manifest of corpus) {
      const candidate = candidateById(result, manifest.id);
      expect(candidate.components.parityHistory).toBe(manifest.evidence.length);
      expect(candidate.components.repairCost).toBe(manifest.failureModes.length);
    }
    expect(candidateById(result, none.id).components.parityHistory).toBe(0);
    expect(candidateById(result, some.id).components.parityHistory).toBe(2);
    expect(candidateById(result, capped.id).components.parityHistory).toBe(7); // raw, uncapped
    expect(candidateById(result, none.id).components.repairCost).toBe(0);
    expect(candidateById(result, some.id).components.repairCost).toBe(3);
    expect(candidateById(result, capped.id).components.repairCost).toBe(9); // raw, uncapped

    // the frozen formula applies, bit-exact, to the measured components
    for (const manifest of corpus) {
      const candidate = candidateById(result, manifest.id);
      expect(candidate.score).toBe(expectedScore(expectedComponents(corpus, manifest, {
        target: 'web',
        requiredCapabilities: [],
      })));
    }

    // the CAPS live in the formula only: 7 evidence entries weigh exactly as
    // 5, and 9 failure modes weigh exactly as 5 (recomputed through the
    // frozen formula — the implementation matched it bit-exact above)
    const cappedComponents = expectedComponents(corpus, capped, { target: 'web', requiredCapabilities: [] });
    expect(expectedScore({ ...cappedComponents, parityHistory: 5 })).toBe(expectedScore(cappedComponents));
    expect(expectedScore({ ...cappedComponents, repairCost: 5 })).toBe(expectedScore(cappedComponents));

    // honesty: the reasons carry the RAW measured counts, with the cap named
    expect(
      candidateById(result, capped.id).reasons.some((reason) => reason.includes('7 evidence entries measured')),
    ).toBe(true);
    expect(
      candidateById(result, capped.id).reasons.some((reason) => reason.includes('9 failure modes measured')),
    ).toBe(true);
    expect(
      candidateById(result, some.id).reasons.some((reason) => reason.includes('3 failure modes measured')),
    ).toBe(true);
  });
});

describe('optional capabilities and maxResults', () => {
  test('optional capabilities and maxResults behave honestly', async () => {
    const a1 = retrievalManifest({
      idSeed: 'a1',
      capabilities: ['api-mock', 'form', 'route'], // optional matched: api-mock → 1/3
      generatedAt: '2026-10-04T00:00:00Z',
    });
    const b2 = retrievalManifest({
      idSeed: 'b2',
      capabilities: ['form', 'navigation', 'route'], // optional matched: navigation → 1/3
      generatedAt: '2026-10-03T00:00:00Z',
    });
    const c3 = retrievalManifest({
      idSeed: 'c3',
      capabilities: ['form', 'navigation', 'storage:local'], // optional matched: 2/3
      generatedAt: '2026-10-02T00:00:00Z',
    });
    const d4 = retrievalManifest({
      idSeed: 'd4',
      capabilities: ['form'], // optional matched: 0/3 — still a candidate
      generatedAt: '2026-10-01T00:00:00Z',
    });
    const corpus = [a1, b2, c3, d4];
    const query: QueryShape = {
      target: 'web',
      requiredCapabilities: ['form'],
      optionalCapabilities: ['api-mock', 'navigation', 'storage:local'],
    };

    // ---- optional capabilities are WEIGHTING, never gating: all four are
    //      candidates, including the zero-optional-match manifest ----
    const result = requireResult(await retrievePackages(corpus, query));
    expect(result.candidates).toHaveLength(4);
    expect(result.excluded).toBe(0);
    for (const manifest of corpus) {
      const candidate = candidateById(result, manifest.id);
      // optional coverage measured independently from the fixture facts
      expect(candidate.components.optionalCoverage).toBe(
        expectedComponents(corpus, manifest, query).optionalCoverage,
      );
    }
    expect(candidateById(result, a1.id).components.optionalCoverage).toBe(1 / 3);
    expect(candidateById(result, b2.id).components.optionalCoverage).toBe(1 / 3);
    expect(candidateById(result, c3.id).components.optionalCoverage).toBe(2 / 3);
    expect(candidateById(result, d4.id).components.optionalCoverage).toBe(0);

    // ---- no optional requested → optionalCoverage is measured 0 for all ----
    const noOptional = requireResult(
      await retrievePackages(corpus, { target: 'web', requiredCapabilities: ['form'] }),
    );
    expect(noOptional.candidates.every((candidate) => candidate.components.optionalCoverage === 0)).toBe(true);
    expect(
      noOptional.candidates.every((candidate) =>
        candidate.reasons.some((reason) => reason.includes('no optional capabilities requested')),
      ),
    ).toBe(true);

    // ---- maxResults truncates AFTER ranking — the survivors are exactly
    //      the head of the UNTRUNCATED order, and the counting stays honest ----
    const full = requireResult(await retrievePackages(corpus, { ...query, maxResults: undefined }));
    const fullOrder = full.candidates.map((candidate) => candidate.id);
    expect(full.candidates).toHaveLength(4);

    const top2 = requireResult(await retrievePackages(corpus, { ...query, maxResults: 2 }));
    expect(top2.candidates.map((candidate) => candidate.id)).toEqual(fullOrder.slice(0, 2));
    expect(top2.considered).toBe(4); // unaffected by truncation
    expect(top2.excluded).toBe(0); // truncation is not exclusion
    expect(top2.reasons.some((reason) => reason.includes('truncated to 2 of 4 ranked candidates by maxResults 2'))).toBe(true);

    const top1 = requireResult(await retrievePackages(corpus, { ...query, maxResults: 1 }));
    expect(top1.candidates.map((candidate) => candidate.id)).toEqual(fullOrder.slice(0, 1));

    // ---- maxResults beyond the ranking returns everything, fabricating
    //      neither candidates nor a truncation reason ----
    const generous = requireResult(await retrievePackages(corpus, { ...query, maxResults: 10 }));
    expect(generous.candidates).toEqual(full.candidates);
    expect(generous.reasons.some((reason) => reason.includes('truncated'))).toBe(false);
  });
});

describe('satisfiability', () => {
  test('every required capability set is satisfiable from the fixture corpus or reported empty with reasons', async () => {
    const corpus = retrievalCorpus();

    // The independent satisfiability oracle, computed from the corpus facts:
    // target-matching manifests whose capabilities include EVERY required one.
    function expectedSatisfiableIds(requiredCapabilities: string[]): string[] {
      return corpus
        .filter(
          (manifest) =>
            manifest.supportedTargets.includes('web') &&
            requiredCapabilities.every((capability) => manifest.capabilities.includes(capability)),
        )
        .map((manifest) => manifest.id)
        .sort();
    }

    const capabilitySets: string[][] = [
      ['api-mock'], // only alpha — satisfiable
      ['form'], // alpha, beta — satisfiable
      ['navigation'], // beta, gamma — satisfiable
      ['route'], // alpha, beta — satisfiable
      ['form', 'route'], // alpha, beta — satisfiable
      ['api-mock', 'form', 'route'], // alpha — satisfiable
      ['storage:local'], // ONLY the desktop-target manifest carries it — honestly unsatisfiable for web
      ['api-mock', 'form', 'navigation', 'route', 'storage:local'], // the full union — unsatisfiable for web
      ['quantum-teleport'], // not in the corpus at all — unsatisfiable
    ];

    for (const requiredCapabilities of capabilitySets) {
      const result = requireResult(
        await retrievePackages(corpus, { target: 'web', requiredCapabilities }),
      );
      const expected = expectedSatisfiableIds(requiredCapabilities);
      // the returned candidate set matches the independent oracle exactly
      expect(result.candidates.map((candidate) => candidate.id).sort()).toEqual(expected);
      expect(result.candidates.every((candidate) => candidate.components.requiredCoverage === 1)).toBe(true);

      if (expected.length > 0) {
        // satisfiable — at least one ranked candidate, every one fully covered
        expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      } else {
        // unsatisfiable — EMPTY, and REPORTED as empty with reasons: the
        // honest summary plus a per-manifest measured exclusion fact
        expect(result.candidates).toEqual([]);
        expect(result.reasons.some((reason) => reason.includes('no candidate satisfies the query'))).toBe(true);
        expect(result.reasons.some((reason) => reason.includes('excluded — required capability coverage'))).toBe(true);
        expect(result.excluded).toBe(5); // every considered manifest failed the gate (measured) — the desktop manifest by target, the four web manifests by coverage
      }
    }

    // the empty corpus is a legal, honest retrieval: zero candidates, zero
    // considered, still content-addressed and reasoned
    const empty = requireResult(await retrievePackages([], { target: 'web', requiredCapabilities: ['form'] }));
    expect(empty.candidates).toEqual([]);
    expect(empty.considered).toBe(0);
    expect(empty.excluded).toBe(0);
    expect(empty.queryDigest).toMatch(/^rq_[0-9a-f]{64}$/);
    expect(empty.reasons.some((reason) => reason.includes('the manifest corpus is empty'))).toBe(true);
  });
});
