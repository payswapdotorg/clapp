/**
 * @clapp/library — the package compatibility graph (CLAPP-051).
 *
 * The P5 lane-2 module over the frozen PackageManifest v0.1 (CLAPP-050):
 * a deterministic, content-addressed pairwise-compatibility graph — the
 * structural substrate the future retrieval lane (CLAPP-052) consumes for
 * its target-compatibility + dependency-compatibility signals
 * (docs/LEARNING_AND_LIBRARY.md §6). Runtime imports are exactly
 * `@clapp/core` (sha256Hex), `@clapp/observe` (canonicalJson) and the local
 * frozen `./package-contract` (same package — the graph imports no contract
 * owner at all).
 *
 * THE CONTRACT (v0.1): every VALIDATED input manifest becomes one CompatNode
 * (the compatibility-relevant manifest facts, verbatim); EVERY unordered
 * pair of nodes becomes exactly one CompatEdge with a fully DERIVED verdict:
 *   'unrelated'  — the pair shares no supported target (the target gate:
 *                  target-disjoint packages never compose);
 *   'conflict'   — both packages name a runtime executable and the
 *                  executables differ (alternative runtimes never compose
 *                  in v0.1);
 *   'compatible' — everything else (shared targets, no runtime clash).
 * Every edge carries the MEASURED intersections (sharedTargets,
 * sharedCapabilities — the capability overlap is reported even on
 * 'unrelated' edges: a measured fact, never a compatibility claim) and
 * honest reasons that name the facts. Overlap counts in reasons are
 * measured from the actual intersections, never asserted.
 *
 * FAIL-CLOSED: buildCompatGraph validates EVERY entry with the frozen
 * validatePackageManifest and rejects duplicate minted ids, collecting ALL
 * errors (each names the offending index and field) into
 * `{ ok: false, errors }` — results, never exceptions. An EMPTY input is a
 * valid, honest graph: zero nodes, zero edges, still content-addressed.
 *
 * DETERMINISM: same manifests in ANY input order → byte-identical graph.
 * Nodes are sorted by id; edges by (left id, then right id) with `left`
 * ALWAYS the lexicographically smaller id regardless of input order;
 * reasons are sorted and deduped; intersections are sorted sets. No clock,
 * no randomness, no network, no filesystem reads; the module never mutates
 * its inputs (pure derivation — node arrays are copied, never aliased).
 *
 * CONTENT-ADDRESSED IDENTITY: graphSha256 = 'cgraph_' +
 * sha256Hex(canonicalJson({ graphVersion, nodes, edges })) — the digest
 * field itself is EXCLUDED from the minting input (the same discipline as
 * `pkg_` / mintPackageId: ids are minted FROM the serialization). The
 * 'cgraph_' prefix is THIS packet's frozen proposal; changing it changes
 * every minted graph id and requires a graph contract version bump.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import {
  PACKAGE_ID_PATTERN,
  PACKAGE_VERSION,
  isObject,
  preview,
  validatePackageManifest,
} from './package-contract';
import type { PackageManifest } from './package-contract';

// ---- the graph contract v0.1 ------------------------------------------------------

/** The compatibility-graph contract version (bumps only via a tech-lead declaration wave). */
export const GRAPH_VERSION = '0.1';

/** The minted graph-id prefix — THIS packet's frozen proposal (same discipline as `pkg_`). */
const CGRAPH_ID_PREFIX = 'cgraph_';

/** The pairwise verdict vocabulary (v0.1 — all derived, all honest). */
export type CompatibilityVerdict = 'compatible' | 'conflict' | 'unrelated';

/** One validated manifest, reduced to its compatibility-relevant facts (verbatim). */
export interface CompatNode {
  /** The manifest's minted id. */
  id: string;
  /** manifest.version — the immutable package version. */
  version: string;
  /** manifest.category. */
  category: string;
  /** manifest.capabilities verbatim (already canonical: sorted by the manifest contract). */
  capabilities: string[];
  /** manifest.supportedTargets verbatim. */
  supportedTargets: string[];
  /** manifest.dependencies verbatim (v0.1: at most one entry — the start command's leading executable). */
  dependencies: string[];
}

/** One unordered pair's derived compatibility, in canonical edge order. */
export interface CompatEdge {
  /** pkg id — ALWAYS the lexicographically smaller id of the pair. */
  left: string;
  /** pkg id — the larger. */
  right: string;
  verdict: CompatibilityVerdict;
  /** Sorted intersection of the pair's supportedTargets. */
  sharedTargets: string[];
  /** Sorted intersection of the pair's capabilities (measured even on 'unrelated' edges). */
  sharedCapabilities: string[];
  /** Honest, deterministic, canonical order (sorted, deduped) — each names the fact. */
  reasons: string[];
}

/** The whole graph — one node per input manifest, one edge per unordered pair. */
export interface CompatGraph {
  /** GRAPH_VERSION ('0.1'). */
  graphVersion: string;
  /** One per input manifest, sorted by id. */
  nodes: CompatNode[];
  /** EVERY unordered pair once, sorted canonically (by left id, then right id). */
  edges: CompatEdge[];
  /** Content-addressed identity: 'cgraph_' + sha256Hex(canonicalJson({ graphVersion, nodes, edges })). */
  graphSha256: string;
}

/** Fail-closed result: a graph, or every collected input error. */
export type CompatGraphResult =
  | { ok: true; graph: CompatGraph }
  | { ok: false; errors: string[] };

// ---- the builder --------------------------------------------------------------------

/**
 * Build the compatibility graph over PackageManifest v0.1 entries.
 * Async because the graph identity hashes (sha256Hex over the canonical
 * record). Fail-closed: a non-array input, ANY invalid manifest entry, or a
 * duplicate minted id returns `{ ok: false, errors }` — never an exception.
 * Empty input is legal (an empty graph is a valid, honest graph).
 */
export async function buildCompatGraph(manifests: unknown): Promise<CompatGraphResult> {
  // ---- 1. fail-closed input validation FIRST (results, never exceptions) ----
  if (!Array.isArray(manifests)) {
    return {
      ok: false,
      errors: [
        `manifests: expected an array of PackageManifest v${PACKAGE_VERSION} entries, got ${preview(manifests)}`,
      ],
    };
  }

  const errors: string[] = [];
  const valid: PackageManifest[] = [];

  // ---- 1a. every entry must pass the frozen validator; ALL errors collected ----
  for (let index = 0; index < manifests.length; index++) {
    const entry: unknown = manifests[index];
    const check = validatePackageManifest(entry);
    if (check.ok) {
      valid.push(entry as PackageManifest); // validation passed — the cast is earned
      continue;
    }
    for (const error of check.errors) {
      errors.push(`manifests[${index}]: ${error}`); // names the index AND (inside) the field
    }
  }

  // ---- 1b. duplicate minted ids (the library never stores one id twice) ----
  const firstSeen = new Map<string, number>();
  for (let index = 0; index < manifests.length; index++) {
    const entry: unknown = manifests[index];
    if (!isObject(entry)) continue; // its shape error is already reported above
    const id = entry.id;
    if (typeof id !== 'string' || !PACKAGE_ID_PATTERN.test(id)) {
      continue; // not a minted id — no duplicate claim is fabricated
    }
    const firstIndex = firstSeen.get(id);
    if (firstIndex === undefined) {
      firstSeen.set(id, index);
    } else {
      errors.push(`duplicate package id ${id} at indexes ${firstIndex} and ${index}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // ---- 2. nodes: the compatibility-relevant manifest facts, verbatim ----
  const nodes: CompatNode[] = valid.map((manifest) => ({
    id: manifest.id,
    version: manifest.version,
    category: manifest.category,
    capabilities: [...manifest.capabilities], // copied — inputs are never mutated or aliased
    supportedTargets: [...manifest.supportedTargets],
    dependencies: [...manifest.dependencies],
  }));
  nodes.sort(byNodeId);

  // ---- 3. edges: EVERY unordered pair exactly once, canonical order ----
  const edges: CompatEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      // nodes are id-sorted, so nodes[i].id < nodes[j].id — `left` is ALWAYS
      // the smaller id, regardless of the caller's input order
      edges.push(buildEdge(nodes[i]!, nodes[j]!));
    }
  }
  // The loop shape above already emits (left, right)-sorted edges; sorted
  // explicitly so the canonical-order contract never depends on the loop.
  edges.sort(byEdgeIds);

  // ---- 4. content-addressed identity (the digest is minted FROM the record) ----
  const canonicalGraphRecord = { graphVersion: GRAPH_VERSION, nodes, edges };
  let graphSha256: string;
  try {
    graphSha256 = `${CGRAPH_ID_PREFIX}${await sha256Hex(canonicalJson(canonicalGraphRecord))}`;
  } catch {
    // Unreachable for validated manifests (nodes and edges are built from
    // validated strings and string arrays) — but fail-closed beats a thrown
    // CanonicalJsonError: the identity is never guessed.
    return {
      ok: false,
      errors: [
        'the canonical graph record is not canonical-JSON serializable — the graph identity cannot be computed honestly',
      ],
    };
  }

  return { ok: true, graph: { graphVersion: GRAPH_VERSION, nodes, edges, graphSha256 } };
}

// ---- derivation helpers (pure, deterministic, honest) --------------------------------

/** Canonical node order: by id (ids are unique — duplicates were rejected). */
function byNodeId(left: CompatNode, right: CompatNode): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Canonical edge order: by left id, then right id. */
function byEdgeIds(left: CompatEdge, right: CompatEdge): number {
  if (left.left !== right.left) return left.left < right.left ? -1 : 1;
  return left.right < right.right ? -1 : left.right > right.right ? 1 : 0;
}

/**
 * The pairwise verdict (§3.2 semantics, all derived). `left.id < right.id`
 * is guaranteed by the caller (id-sorted iteration).
 */
function buildEdge(left: CompatNode, right: CompatNode): CompatEdge {
  const sharedTargets = sortedIntersection(left.supportedTargets, right.supportedTargets);
  const sharedCapabilities = sortedIntersection(left.capabilities, right.capabilities);

  let verdict: CompatibilityVerdict;
  const reasons: string[] = [];

  if (sharedTargets.length === 0) {
    // ---- 1. the target gate: target-disjoint packages never compose ----
    verdict = 'unrelated';
    reasons.push(
      `no shared supported target — ${left.id} targets ${renderList(left.supportedTargets)}, ` +
        `${right.id} targets ${renderList(right.supportedTargets)}`,
    );
    // sharedCapabilities stays on the edge (measured even here): a measured
    // fact, not a compatibility claim — never zeroed to match the verdict.
  } else {
    // v0.1 dependencies carry at most one entry — the start command's
    // leading executable (the frozen extractor discipline) — so the leading
    // entries ARE "the executables". Multi-entry dependency semantics
    // arrive with a future contract version; the verbatim arrays stay on
    // the nodes either way.
    const leftExecutable = left.dependencies[0];
    const rightExecutable = right.dependencies[0];
    if (
      leftExecutable !== undefined &&
      rightExecutable !== undefined &&
      leftExecutable !== rightExecutable
    ) {
      // ---- 2. alternative runtimes never compose in v0.1 ----
      verdict = 'conflict';
      reasons.push(
        `alternative runtimes never compose in v0.1 — ${left.id} requires ${JSON.stringify(leftExecutable)}, ` +
          `${right.id} requires ${JSON.stringify(rightExecutable)}`,
      );
    } else {
      // ---- 3. compatible: the shared facts, measured ----
      verdict = 'compatible';
      reasons.push(`${sharedTargets.length} shared supported targets: ${renderList(sharedTargets)}`);
      reasons.push(
        `${sharedCapabilities.length} shared capabilities: ${renderList(sharedCapabilities)}`,
      );
    }
  }

  return {
    left: left.id,
    right: right.id,
    verdict,
    sharedTargets,
    sharedCapabilities,
    reasons: [...new Set(reasons)].sort(), // canonical order, deterministic
  };
}

/** Sorted intersection as a set (deduped, canonical order). */
function sortedIntersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => rightSet.has(value)).sort();
}

/** Honest list rendering for reasons: the JSON array text of the actual values. */
function renderList(values: readonly string[]): string {
  return JSON.stringify([...values]);
}
