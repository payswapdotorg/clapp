// CLAPP-051 — the compatibility-graph tests: determinism (any input order →
// byte-identical graph), fail-closed validation (malformed manifests +
// duplicate minted ids — never an exception), the three verdict semantics
// (unrelated / conflict / compatible — every overlap measured from the
// fixture facts, never asserted), the canonical edge structure (every
// unordered pair exactly once, left < right, the empty graph valid and
// content-addressed), and the content-addressed identity (any input change
// moves the digest; unchanged pair-edges stay byte-stable).

import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import { GRAPH_VERSION, buildCompatGraph } from '../src/compat-graph';
import type { CompatEdge, CompatGraph, CompatGraphResult } from '../src/compat-graph';
import { compatManifest } from './fixtures/compat-manifests';

/** Fail loudly (with the honest errors) if a fixture graph did not build. */
function requireGraph(result: CompatGraphResult): CompatGraph {
  if (!result.ok) {
    throw new Error(`expected a built graph, got fail-closed errors: ${result.errors.join('; ')}`);
  }
  return result.graph;
}

/** The canonical minting input (graphSha256 excluded) — the byte-identity yardstick. */
function canonicalGraphRecord(graph: CompatGraph): string {
  return canonicalJson({
    graphVersion: graph.graphVersion,
    nodes: graph.nodes,
    edges: graph.edges,
  });
}

function edgeBetween(graph: CompatGraph, left: string, right: string): CompatEdge | undefined {
  return graph.edges.find((edge) => edge.left === left && edge.right === right);
}

describe('determinism', () => {
  test('the graph is deterministic — identical manifests in any input order build byte-identical graphs', async () => {
    const alpha = compatManifest({
      idSeed: 'a1',
      overrides: { capabilities: ['api-mock', 'form', 'route'], dependencies: ['bun'] },
    });
    const beta = compatManifest({
      idSeed: 'b2',
      overrides: { capabilities: ['form', 'navigation', 'route'] },
    });
    const gamma = compatManifest({
      idSeed: 'c3',
      overrides: { capabilities: ['navigation'], dependencies: ['node'], supportedTargets: ['android', 'web'] },
    });
    // the trio exercises every verdict: (a,b) compatible, (a,c) conflict
    // (bun vs node over the shared 'web' target), (b,c) compatible (either
    // dependencies empty → no runtime clash).

    const first = requireGraph(await buildCompatGraph([alpha, beta, gamma]));
    const second = requireGraph(await buildCompatGraph([gamma, alpha, beta])); // permuted
    const third = requireGraph(await buildCompatGraph([beta, gamma, alpha])); // permuted again

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(second.graphSha256).toBe(first.graphSha256);
    expect(third.graphSha256).toBe(first.graphSha256);
    // byte-identical: the canonical minting inputs serialize identically
    expect(canonicalGraphRecord(second)).toBe(canonicalGraphRecord(first));
    expect(canonicalGraphRecord(third)).toBe(canonicalGraphRecord(first));
  });
});

describe('fail-closed validation', () => {
  test('malformed manifests fail closed with named errors — never an exception', async () => {
    const badVersion = compatManifest({ idSeed: 'm1', overrides: { packageVersion: '9.9' } });
    const unsortedCapabilities = compatManifest({
      idSeed: 'm2',
      overrides: { capabilities: ['form', 'api-mock'] }, // 'form' > 'api-mock' — not canonical order
    });

    // never an exception: the rejection (if any) is observed explicitly
    const outcome = await buildCompatGraph([badVersion, unsortedCapabilities]).then(
      (value) => ({ threw: false as const, value }),
      (error: unknown) => ({ threw: true as const, error }),
    );
    expect(outcome.threw).toBe(false);

    const result = outcome.value;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail-closed errors');
    // ALL errors collected (never stops at the first), each naming the
    // offending index AND the offending field
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(
      result.errors.some((error) => error.includes('manifests[0]') && error.includes('packageVersion')),
    ).toBe(true);
    expect(
      result.errors.some((error) => error.includes('manifests[1]') && error.includes('capabilities')),
    ).toBe(true);
  });

  test('duplicate package ids fail closed', async () => {
    const once = compatManifest({ idSeed: 'a1', overrides: { capabilities: ['route'] } });
    const twice = compatManifest({ idSeed: 'a1', overrides: { capabilities: ['navigation'] } }); // SAME minted id

    const result = await buildCompatGraph([once, twice]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail-closed errors');
    // both manifests are individually valid — the duplicate is the ONLY error
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(`duplicate package id ${once.id}`);
    expect(result.errors[0]).toContain('at indexes 0 and 1');
  });
});

describe('pairwise verdict semantics', () => {
  test('target-disjoint packages are unrelated — the verdict never fabricates compatibility', async () => {
    const webPackage = compatManifest({
      idSeed: 'a1',
      overrides: { capabilities: ['navigation', 'route'] },
    });
    const mobilePackage = compatManifest({
      idSeed: 'b2',
      overrides: { capabilities: ['route'], supportedTargets: ['android', 'ios'] },
    });

    // input order deliberately reversed — edge order is canonical regardless
    const graph = requireGraph(await buildCompatGraph([mobilePackage, webPackage]));
    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0]!;
    expect(edge.verdict).toBe('unrelated');
    expect(edge.sharedTargets).toEqual([]);

    // the reason names BOTH packages' target sets, honestly
    const reason = edge.reasons.find((candidate) => candidate.includes('no shared supported target'))!;
    expect(reason).toContain(webPackage.id);
    expect(reason).toContain(mobilePackage.id);
    expect(reason).toContain('["web"]');
    expect(reason).toContain('["android","ios"]');

    // the capability overlap is still MEASURED on the edge — a fact, not a claim
    expect(edge.sharedCapabilities).toEqual(['route']);
  });

  test('alternative runtimes conflict — bun and node never compose in v0.1', async () => {
    const bunPackage = compatManifest({ idSeed: 'a1', overrides: { dependencies: ['bun'] } });
    const nodePackage = compatManifest({ idSeed: 'b2', overrides: { dependencies: ['node'] } });

    const graph = requireGraph(await buildCompatGraph([bunPackage, nodePackage]));
    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0]!;
    expect(edge.verdict).toBe('conflict');
    // the shared target is measured even on a conflicting edge
    expect(edge.sharedTargets).toEqual(['web']);

    const reason = edge.reasons.find((candidate) => candidate.includes('never compose'))!;
    expect(reason).toContain('bun');
    expect(reason).toContain('node');
    expect(reason).toContain(bunPackage.id);
    expect(reason).toContain(nodePackage.id);
  });

  test('compatible pairs carry honest measured overlap — shared targets, shared capabilities, reasons', async () => {
    const left = compatManifest({
      idSeed: 'a1',
      overrides: { capabilities: ['api-mock', 'form', 'route'], supportedTargets: ['web'] },
    });
    const right = compatManifest({
      idSeed: 'b2',
      overrides: { capabilities: ['form', 'navigation', 'route'] },
    });

    // reversed input order — left/right on the edge is canonical regardless
    const graph = requireGraph(await buildCompatGraph([right, left]));
    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0]!;
    expect(edge.verdict).toBe('compatible');
    expect(edge.left).toBe(left.id); // a1 < b2 — ALWAYS the smaller id
    expect(edge.right).toBe(right.id);

    // the measured sets, recomputed HERE from the fixture facts (never
    // asserted from the implementation)
    const measuredTargets = [...new Set(left.supportedTargets)]
      .filter((target) => new Set(right.supportedTargets).has(target))
      .sort();
    const measuredCapabilities = [...new Set(left.capabilities)]
      .filter((capability) => new Set(right.capabilities).has(capability))
      .sort();
    expect(edge.sharedTargets).toEqual(measuredTargets);
    expect(edge.sharedCapabilities).toEqual(measuredCapabilities);

    // the reasons carry the MEASURED counts and lists — the count matches
    // the actual overlap length
    const targetReason = edge.reasons.find((candidate) =>
      candidate.includes('shared supported targets'),
    )!;
    expect(targetReason).toContain(`${measuredTargets.length} shared supported targets`);
    expect(targetReason).toContain(JSON.stringify(measuredTargets));
    const capabilityReason = edge.reasons.find((candidate) =>
      candidate.includes('shared capabilities'),
    )!;
    expect(capabilityReason).toContain(`${measuredCapabilities.length} shared capabilities`);
    expect(capabilityReason).toContain(JSON.stringify(measuredCapabilities));

    // reasons are canonical: sorted and deduped
    expect(edge.reasons).toEqual([...new Set(edge.reasons)].sort());
  });
});

describe('graph structure', () => {
  test('every unordered pair appears exactly once with canonical edge order', async () => {
    const manifests = [
      compatManifest({ idSeed: 'a1', overrides: { capabilities: ['route'] } }),
      compatManifest({ idSeed: 'b2', overrides: { capabilities: ['form'], dependencies: ['bun'] } }),
      compatManifest({
        idSeed: 'c3',
        overrides: { capabilities: ['route'], supportedTargets: ['android', 'web'] },
      }),
      compatManifest({
        idSeed: 'd4',
        overrides: { capabilities: ['navigation'], supportedTargets: ['ios'] },
      }),
    ];
    // reversed input — the structure is canonical regardless of input order
    const graph = requireGraph(await buildCompatGraph([...manifests].reverse()));

    // 4 nodes, sorted by id
    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes.map((node) => node.id)).toEqual(manifests.map((m) => m.id).sort());

    // C(4,2) = 6 edges — every unordered pair EXACTLY once
    expect(graph.edges).toHaveLength(6);
    const pairKeys = new Set(graph.edges.map((edge) => `${edge.left}|${edge.right}`));
    expect(pairKeys.size).toBe(6);
    for (const edge of graph.edges) {
      expect(edge.left < edge.right).toBe(true); // left is ALWAYS the smaller id
    }
    for (let i = 0; i < graph.nodes.length; i++) {
      for (let j = i + 1; j < graph.nodes.length; j++) {
        const count = graph.edges.filter(
          (edge) => edge.left === graph.nodes[i]!.id && edge.right === graph.nodes[j]!.id,
        ).length;
        expect(count).toBe(1);
      }
    }
    // edges sorted canonically: by left id, then right id
    const byCanonicalEdgeOrder = (x: CompatEdge, y: CompatEdge): number =>
      x.left !== y.left ? (x.left < y.left ? -1 : 1) : x.right < y.right ? -1 : x.right > y.right ? 1 : 0;
    expect(graph.edges).toEqual([...graph.edges].sort(byCanonicalEdgeOrder));

    // the empty graph is a valid, honest graph — zero nodes, zero edges,
    // still content-addressed
    const empty = requireGraph(await buildCompatGraph([]));
    expect(empty.graphVersion).toBe(GRAPH_VERSION);
    expect(empty.nodes).toEqual([]);
    expect(empty.edges).toEqual([]);
    expect(empty.graphSha256).toMatch(/^cgraph_[0-9a-f]{64}$/);
    // the digest is exactly the content-address of the canonical empty
    // record — measured here, independently of the implementation
    expect(empty.graphSha256).toBe(
      `cgraph_${await sha256Hex(canonicalJson({ graphVersion: GRAPH_VERSION, nodes: [], edges: [] }))}`,
    );
  });
});

describe('content-addressed identity', () => {
  test('the graph is content-addressed — any input change changes the identity', async () => {
    const alpha = compatManifest({ idSeed: 'a1', overrides: { capabilities: ['form', 'route'] } });
    const beta = compatManifest({ idSeed: 'b2', overrides: { capabilities: ['form'] } });
    const gamma = compatManifest({ idSeed: 'c3', overrides: { capabilities: ['navigation'] } });

    const baseline = requireGraph(await buildCompatGraph([alpha, beta, gamma]));

    // ONE manifest's capability changes — the SAME minted id, different facts
    const gammaChanged = compatManifest({
      idSeed: 'c3',
      overrides: { capabilities: ['navigation', 'storage:cookie'] },
    });
    expect(gammaChanged.id).toBe(gamma.id); // the change is a capability, not an identity change

    const changed = requireGraph(await buildCompatGraph([alpha, beta, gammaChanged]));
    expect(changed.nodes).toHaveLength(3);
    expect(changed.graphSha256).not.toBe(baseline.graphSha256); // any input change moves the identity

    // the changed node honestly carries the new capability
    const changedNode = changed.nodes.find((node) => node.id === gamma.id)!;
    expect(changedNode.capabilities).toEqual(['navigation', 'storage:cookie']);

    // the (alpha, beta) pair-edge is byte-stable — the change is irrelevant
    // to that pair
    const baselineEdge = edgeBetween(baseline, alpha.id, beta.id)!;
    const changedEdge = edgeBetween(changed, alpha.id, beta.id)!;
    expect(changedEdge).toEqual(baselineEdge);
    expect(canonicalJson(changedEdge)).toBe(canonicalJson(baselineEdge));
  });
});
