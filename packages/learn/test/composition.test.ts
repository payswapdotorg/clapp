// CLAPP-063 — the composition planner tests (the W2 learning lane, the
// P6 fourth checkbox: "composition planning").
//
// Fixtures: test/fixtures/failure-fixtures.ts (the APPENDED CLAPP-063
// section — full PackageManifest v0.1 corpus literals whose dependency /
// target / evidence levers make the frozen rules produce KNOWN verdicts
// and rankings). The frozen library is imported at RUNTIME by the tests
// themselves to MEASURE the frozen facts the plan consumed — the ranking
// (retrievePackages), the binding verdicts (buildCompatGraph), and the
// verbatim error lists — never to re-derive them: every expected value in
// these tests is either a fixture-derived fact or a direct measurement of
// the frozen machinery's own output.
//
// The eight named tests cover the packet's axes: determinism (including
// corpus input-order independence), fail-closed admission with errors
// carried verbatim from the frozen modules, greedy rank-ordered selection,
// the binding conflict verdict, target disjointness, the measured rank
// cut, the legal empty-corpus plan, and content-addressed identities.
//
// DISCLOSED (the 061/062 packet-conflict precedent): the packet's test 5
// asks for "ranked candidates with disjoint supportedTargets", but the
// FROZEN retrieval's candidacy gate requires `query.target ∈
// manifest.supportedTargets` for EVERY ranked candidate (its own header
// documents the gate as "the single-manifest reduction of the compat-graph
// target gate"), so any two ranked candidates always share the query
// target and the planner's 'unrelated' branch is structurally unreachable
// through planComposition in v0.1. The test below (byte-exact name)
// exercises the honest behavior instead: it MEASURES the frozen edge's
// 'unrelated' verdict over the disjoint pair (both target sets named, the
// frozen edge's discipline), then verifies the frozen target gate excludes
// the disjoint candidate BEFORE ranking — honestly absent from the plan.

import { describe, expect, test } from 'bun:test';

import { buildCompatGraph, retrievePackages } from '@clapp/library';

import { COMPOSITION_VERSION, planComposition } from '../src/composition';
import type { CompositionPlan } from '../src/composition';
import { PLANNED_AT_A, corpusManifest, packageId } from './fixtures/failure-fixtures';

/** The full-coverage query the fixture corpora are shaped for. */
const WEB_ROUTE_QUERY = { target: 'web', requiredCapabilities: ['route'] };

/** Plan and be loud about it — a fixture failure must not pass silently. */
async function plan(
  corpus: unknown,
  query: unknown,
  options: unknown,
): Promise<CompositionPlan> {
  const result = await planComposition(corpus, query, options);
  if (!result.ok) {
    throw new Error(`planning failed: ${result.errors.join('; ')}`);
  }
  return result.plan;
}

describe('the composition planner (CLAPP-063)', () => {
  test('planning is deterministic — identical corpus, query, and options produce identical plans', async () => {
    // A mixed corpus: a1 (bun) selected first; b2 (node) conflicts with a1;
    // c3 (bun) compatible with a1 — the walk exercises both outcomes.
    const corpus = [
      corpusManifest({ idSeed: 'a1', evidenceCount: 5, dependencies: ['bun'] }),
      corpusManifest({ idSeed: 'b2', evidenceCount: 3, dependencies: ['node'] }),
      corpusManifest({ idSeed: 'c3', evidenceCount: 1, dependencies: ['bun'] }),
    ];
    const options = { plannedAt: PLANNED_AT_A };

    const first = await planComposition(corpus, WEB_ROUTE_QUERY, options);
    const second = await planComposition(corpus, WEB_ROUTE_QUERY, options);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.plan).toEqual(first.plan); // deep-equal
      expect(second.plan.id).toBe(first.plan.id); // identical comp_ id
      expect(first.plan.id).toMatch(/^comp_[0-9a-f]{64}$/);
    }

    // Corpus INPUT-ORDER independence (the 060/061/062 house law): the same
    // manifests in a different input order plan identically — the admission
    // graph, the retrieval ranking, the induced subgraph and the canonical
    // excluded order are all order-independent derivations.
    const shuffled = await planComposition(
      [corpus[2]!, corpus[0]!, corpus[1]!],
      WEB_ROUTE_QUERY,
      options,
    );
    expect(shuffled.ok).toBe(true);
    if (shuffled.ok && first.ok) {
      expect(shuffled.plan).toEqual(first.plan);
      expect(shuffled.plan.id).toBe(first.plan.id);
    }
  });

  test('malformed corpora, options, or queries fail closed with named errors carried verbatim — never an exception', async () => {
    const goodCorpus = [
      corpusManifest({ idSeed: 'a1', evidenceCount: 5, dependencies: ['bun'] }),
      corpusManifest({ idSeed: 'b2', evidenceCount: 3, dependencies: ['bun'] }),
    ];

    // An invalid manifest → the frozen graph's own errors, carried VERBATIM
    // (measured: the graph is called directly and its error list compared).
    const badCorpus = [
      corpusManifest({ idSeed: 'a1', evidenceCount: 5, dependencies: ['bun'] }),
      { ...corpusManifest({ idSeed: 'b2', evidenceCount: 3 }), purpose: '' },
    ];
    const graphCheck = await buildCompatGraph(badCorpus);
    expect(graphCheck.ok).toBe(false);
    const badCorpusResult = await planComposition(badCorpus, WEB_ROUTE_QUERY, {
      plannedAt: PLANNED_AT_A,
    });
    expect(badCorpusResult.ok).toBe(false);
    if (!badCorpusResult.ok && !graphCheck.ok) {
      expect(badCorpusResult.errors).toEqual(graphCheck.errors); // verbatim carry
      expect(badCorpusResult.errors.some((error) => error.includes('purpose'))).toBe(true);
    }

    // A non-RFC3339 plannedAt — including the rollover date 2026-02-30,
    // which Date.parse silently accepts and the calendar-valid check
    // refuses.
    for (const plannedAt of ['not-a-timestamp', '2026-02-30T00:00:00Z']) {
      const badTime = await planComposition(goodCorpus, WEB_ROUTE_QUERY, { plannedAt });
      expect(badTime.ok).toBe(false);
      if (!badTime.ok) {
        expect(badTime.errors.some((error) => error.includes('options.plannedAt'))).toBe(true);
      }
    }

    // A bad maxComponents — not a positive integer.
    for (const maxComponents of [0, -1, 2.5, 'three' as unknown as number]) {
      const badCap = await planComposition(goodCorpus, WEB_ROUTE_QUERY, {
        plannedAt: PLANNED_AT_A,
        maxComponents,
      });
      expect(badCap.ok).toBe(false);
      if (!badCap.ok) {
        expect(badCap.errors.some((error) => error.includes('options.maxComponents'))).toBe(true);
      }
    }

    // A non-object options.
    const badOptions = await planComposition(goodCorpus, WEB_ROUTE_QUERY, null);
    expect(badOptions.ok).toBe(false);
    if (!badOptions.ok) {
      expect(badOptions.errors.some((error) => error.startsWith('options:'))).toBe(true);
    }

    // An invalid query → the frozen retrieval's own errors, carried VERBATIM
    // (measured: the retrieval is called directly and its error list
    // compared). Query validation is the retrieval's authority.
    const badQuery = { target: '', requiredCapabilities: [] };
    const retrievalCheck = await retrievePackages(goodCorpus, badQuery);
    expect(retrievalCheck.ok).toBe(false);
    const badQueryResult = await planComposition(goodCorpus, badQuery, {
      plannedAt: PLANNED_AT_A,
    });
    expect(badQueryResult.ok).toBe(false);
    if (!badQueryResult.ok && !retrievalCheck.ok) {
      expect(badQueryResult.errors).toEqual(retrievalCheck.errors); // verbatim carry
      expect(badQueryResult.errors.some((error) => error.includes('query.target'))).toBe(true);
    }

    // Fail closed, proven: every call above RESOLVED (never threw) and
    // returned { ok: false } — the awaits resolving are themselves the
    // never-an-exception proof.
  });

  test('selection is greedy in frozen retrieval order — the first candidate always enters', async () => {
    // Three mutually compatible candidates (the same executable) with
    // distinct measured scores (the evidence-count lever), under a
    // full-coverage query.
    const corpus = [
      corpusManifest({ idSeed: 'a1', evidenceCount: 5, dependencies: ['bun'] }),
      corpusManifest({ idSeed: 'b2', evidenceCount: 3, dependencies: ['bun'] }),
      corpusManifest({ idSeed: 'c3', evidenceCount: 1, dependencies: ['bun'] }),
    ];

    const result = await planComposition(corpus, WEB_ROUTE_QUERY, { plannedAt: PLANNED_AT_A });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // MEASURE the frozen ranking (never assert it) and compare: the
      // selection order IS the retrieval rank order.
      const retrieval = await retrievePackages(corpus, WEB_ROUTE_QUERY);
      expect(retrieval.ok).toBe(true);
      if (retrieval.ok) {
        expect(result.plan.selected.map((component) => component.id)).toEqual(
          retrieval.result.candidates.map((candidate) => candidate.id),
        );
        expect(result.plan.selected.map((component) => component.rank)).toEqual([0, 1, 2]);
        // The scores are the frozen composite, carried VERBATIM.
        expect(result.plan.selected.map((component) => component.score)).toEqual(
          retrieval.result.candidates.map((candidate) => candidate.score),
        );
      }

      // The FIRST candidate always enters — rank 0 is selected regardless
      // (no pairs exist yet, and rank 0 is never rank-cut).
      expect(result.plan.selected[0]?.rank).toBe(0);
      expect(result.plan.selected.length).toBe(3);
      expect(result.plan.excluded).toEqual([]);

      // Measured facts: three ranked candidates, C(3,2) = 3 induced edges.
      expect(result.plan.considered).toBe(3);
      expect(result.plan.graphEdgeCount).toBe(3);
      expect(result.plan.compositionVersion).toBe(COMPOSITION_VERSION);
    }
  });

  test('a runtime conflict excludes the conflicting later candidate — the verdict binds', async () => {
    // Ranked candidate 1 (rank 0) depends 'bun'; candidate 2 (rank 1)
    // depends 'node' — shared targets, alternative runtimes.
    const corpus = [
      corpusManifest({ idSeed: 'a1', evidenceCount: 5, dependencies: ['bun'] }),
      corpusManifest({ idSeed: 'b2', evidenceCount: 3, dependencies: ['node'] }),
    ];

    // MEASURE the frozen verdict that binds (never re-derived by the test).
    const graph = await buildCompatGraph(corpus);
    expect(graph.ok).toBe(true);
    if (graph.ok) {
      const edge = graph.graph.edges[0];
      if (edge === undefined) {
        throw new Error('the pair must carry exactly one edge');
      }
      expect(edge.verdict).toBe('conflict');
      expect(edge.left).toBe(packageId('a1'));
      expect(edge.right).toBe(packageId('b2'));
    }

    const result = await planComposition(corpus, WEB_ROUTE_QUERY, { plannedAt: PLANNED_AT_A });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Candidate 1 selected; candidate 2 excluded — the verdict binds.
      expect(result.plan.selected.map((component) => component.id)).toEqual([packageId('a1')]);
      expect(result.plan.selected[0]?.rank).toBe(0);
      expect(result.plan.excluded.length).toBe(1);
      const excluded = result.plan.excluded[0];
      if (excluded === undefined) {
        throw new Error('the conflicting candidate must be excluded');
      }
      expect(excluded.id).toBe(packageId('b2'));
      // The reason names BOTH ids and the conflict rule.
      expect(excluded.reason.includes(packageId('a1'))).toBe(true);
      expect(excluded.reason.includes(packageId('b2'))).toBe(true);
      expect(excluded.reason.includes('runtime conflict with selected')).toBe(true);

      // Measured facts: both candidates ranked, one induced edge.
      expect(result.plan.considered).toBe(2);
      expect(result.plan.graphEdgeCount).toBe(1);
    }
  });

  test('target disjointness excludes honestly — unrelated candidates cannot compose', async () => {
    // a1 targets ['web']; b2 targets ['node'] — target-DISJOINT. Through
    // the frozen retrieval, a candidate not supporting the query target
    // NEVER RANKS (the retrieval's own documented "single-manifest
    // reduction of the compat-graph target gate"), so two ranked
    // candidates can never be disjoint: the planner's 'unrelated' branch
    // (implemented per the work order §3.2) is defensive completeness,
    // unreachable via planComposition in v0.1. The honest test: measure
    // the frozen edge's verdict over the disjoint pair, then verify the
    // plan never admits the disjoint candidate.
    const corpus = [
      corpusManifest({ idSeed: 'a1', evidenceCount: 5, supportedTargets: ['web'] }),
      corpusManifest({ idSeed: 'b2', evidenceCount: 3, supportedTargets: ['node'] }),
    ];

    // 1. MEASURE the frozen verdict: 'unrelated', with BOTH target sets
    //    named in the frozen edge's own discipline.
    const graph = await buildCompatGraph(corpus);
    expect(graph.ok).toBe(true);
    if (graph.ok) {
      const edge = graph.graph.edges[0];
      if (edge === undefined) {
        throw new Error('the disjoint pair must carry exactly one edge');
      }
      expect(edge.verdict).toBe('unrelated');
      expect(edge.left).toBe(packageId('a1'));
      expect(edge.right).toBe(packageId('b2'));
      expect(edge.sharedTargets).toEqual([]);
      expect(edge.reasons.some((reason) => reason.includes('no shared supported target'))).toBe(
        true,
      );
      expect(
        edge.reasons.some((reason) => reason.includes('["web"]') && reason.includes('["node"]')),
      ).toBe(true);
    }

    // 2. MEASURE the frozen target gate: b2 never ranks for a 'web' query,
    //    with the retrieval's own honest exclusion reason naming the
    //    mismatch (unrelated candidates cannot compose — excluded BEFORE
    //    ranking, never a plan-level exclusion).
    const retrieval = await retrievePackages(corpus, WEB_ROUTE_QUERY);
    expect(retrieval.ok).toBe(true);
    if (retrieval.ok) {
      expect(retrieval.result.candidates.map((candidate) => candidate.id)).toEqual([
        packageId('a1'),
      ]);
      expect(
        retrieval.result.reasons.some(
          (reason) =>
            reason.includes(packageId('b2')) && reason.includes('not among the measured supportedTargets'),
        ),
      ).toBe(true);
    }

    // 3. The plan: the disjoint candidate never enters — selected [a1],
    //    NO plan-level exclusion (it was never a candidate), considered 1,
    //    zero induced edges.
    const result = await planComposition(corpus, WEB_ROUTE_QUERY, { plannedAt: PLANNED_AT_A });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.selected.map((component) => component.id)).toEqual([packageId('a1')]);
      expect(result.plan.excluded).toEqual([]);
      expect(result.plan.considered).toBe(1);
      expect(result.plan.graphEdgeCount).toBe(0);
      expect(result.plan.queryDigest.startsWith('rq_')).toBe(true);
    }
  });

  test('maxComponents cuts by measured rank with honest reasons', async () => {
    // Three mutually compatible candidates; the cap admits the first two.
    const corpus = [
      corpusManifest({ idSeed: 'a1', evidenceCount: 5, dependencies: ['bun'] }),
      corpusManifest({ idSeed: 'b2', evidenceCount: 3, dependencies: ['bun'] }),
      corpusManifest({ idSeed: 'c3', evidenceCount: 1, dependencies: ['bun'] }),
    ];

    const result = await planComposition(corpus, WEB_ROUTE_QUERY, {
      plannedAt: PLANNED_AT_A,
      maxComponents: 2,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Selected EXACTLY 2 — the first two ranks, in rank order.
      expect(result.plan.selected.length).toBe(2);
      expect(result.plan.selected.map((component) => component.id)).toEqual([
        packageId('a1'),
        packageId('b2'),
      ]);
      expect(result.plan.selected.map((component) => component.rank)).toEqual([0, 1]);

      // The third is excluded by the rank cut, with its MEASURED rank
      // named in the reason.
      expect(result.plan.excluded.length).toBe(1);
      const third = result.plan.excluded[0];
      if (third === undefined) {
        throw new Error('the third candidate must be rank-cut');
      }
      expect(third.id).toBe(packageId('c3'));
      expect(third.reason.includes('rank cut')).toBe(true);
      expect(third.reason.includes('rank 2')).toBe(true);

      // Measured facts: all three ranked; the induced subgraph still spans
      // all ranked candidates (the cap cuts selection, not measurement).
      expect(result.plan.considered).toBe(3);
      expect(result.plan.graphEdgeCount).toBe(3);
    }
  });

  test('the empty corpus plans legally — zero selected, measured zeros, a valid query digest', async () => {
    const query = { target: 'web', requiredCapabilities: [] };
    const result = await planComposition([], query, { plannedAt: PLANNED_AT_A });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.compositionVersion).toBe(COMPOSITION_VERSION);
      expect(result.plan.selected).toEqual([]);
      expect(result.plan.excluded).toEqual([]);
      // Measured zeros (never asserted into the plan — counted).
      expect(result.plan.considered).toBe(0);
      expect(result.plan.graphEdgeCount).toBe(0);
      expect(result.plan.plannedAt).toBe(PLANNED_AT_A);

      // The rq_ digest is carried VERBATIM from the frozen retrieval over
      // the empty corpus (measured by calling the retrieval directly).
      const retrieval = await retrievePackages([], query);
      expect(retrieval.ok).toBe(true);
      if (retrieval.ok) {
        expect(result.plan.queryDigest).toBe(retrieval.result.queryDigest);
      }
      expect(result.plan.queryDigest.startsWith('rq_')).toBe(true);

      // A valid content-addressed comp_ id.
      expect(result.plan.id).toMatch(/^comp_[0-9a-f]{64}$/);
    }
  });

  test('plan ids are content-addressed — any selection change moves the id', async () => {
    // Baseline: a1 (bun) selected, b2 (node) excluded — the conflict binds.
    const baselineCorpus = [
      corpusManifest({ idSeed: 'a1', evidenceCount: 5, dependencies: ['bun'] }),
      corpusManifest({ idSeed: 'b2', evidenceCount: 3, dependencies: ['node'] }),
    ];
    const baseline = await plan(baselineCorpus, WEB_ROUTE_QUERY, { plannedAt: PLANNED_AT_A });
    expect(baseline.id).toMatch(/^comp_[0-9a-f]{64}$/);
    expect(baseline.selected.map((component) => component.id)).toEqual([packageId('a1')]);
    expect(baseline.excluded.length).toBe(1);

    // The tweak: b2's dependency 'node' → 'bun' — the pair verdict flips
    // ('conflict' → 'compatible'), the selection changes, and the id moves.
    const flippedCorpus = [
      corpusManifest({ idSeed: 'a1', evidenceCount: 5, dependencies: ['bun'] }),
      corpusManifest({ idSeed: 'b2', evidenceCount: 3, dependencies: ['bun'] }),
    ];
    const flipped = await plan(flippedCorpus, WEB_ROUTE_QUERY, { plannedAt: PLANNED_AT_A });
    expect(flipped.id).toMatch(/^comp_[0-9a-f]{64}$/);
    expect(flipped.selected.map((component) => component.id)).toEqual([
      packageId('a1'),
      packageId('b2'),
    ]);
    expect(flipped.excluded).toEqual([]);
    expect(flipped.id).not.toBe(baseline.id);

    // The queryDigest stays BYTE-STABLE — the query is unchanged (the rq_
    // digest covers the query, not the corpus).
    expect(flipped.queryDigest).toBe(baseline.queryDigest);

    // The complementary fact (honest content-addressing): the SAME corpus
    // under a DIFFERENT — still full-coverage — query mints a different
    // rq_ digest and therefore a different comp_ id, even though the
    // selection is identical.
    const reQueried = await plan(flippedCorpus, { target: 'web', requiredCapabilities: [] }, {
      plannedAt: PLANNED_AT_A,
    });
    expect(reQueried.selected).toEqual(flipped.selected);
    expect(reQueried.excluded).toEqual(flipped.excluded);
    expect(reQueried.queryDigest).not.toBe(flipped.queryDigest);
    expect(reQueried.id).not.toBe(flipped.id);
  });
});
