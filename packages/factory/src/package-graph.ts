/**
 * @clapp/factory — the package-graph synthesizer (CLAPP-087, the P9 third
 * lane — Worker 1, Observation and Platform Adapters, per
 * docs/WORKER_HANDOFFS.md; the factory lane's owner).
 *
 * docs/WORK_ITEMS.md P9: "The factory turns a build request into a
 * classified target, explores within adaptive budgets, synthesizes the
 * package graph, repairs multi-pass, and holds the release for the human
 * gate." THIS module is the factory's THIRD component: the package graph
 * the codegen lane will walk — synthesized from a CLAPP-085 target
 * classification (this package's own first component) and a CLAPP-063
 * learn-lane composition plan, the two frozen inputs of the synthesis
 * pipeline's "package retrieval → composition plan → code generation"
 * seam (docs/ARCHITECTURE.md §2).
 *
 * THE BINDINGS (consumed, never forked):
 * - The classification — this package's own ./target-classification —
 *   enters as DATA, duck-validated on exactly the two fields this lane
 *   consumes (targetVersion, id), with a named error for every
 *   malformation, and its tcls_ id carried VERBATIM as the graph's
 *   classificationId (the provenance binding; the 086 resolver's law).
 * - The learn lane's CompositionPlan enters as DATA, duck-validated on
 *   exactly the three fields this lane consumes (compositionVersion, id,
 *   selected[].id). The shape is referenced TYPE-ONLY (@clapp/learn is a
 *   devDependency — the import-discipline test in
 *   test/package-graph.test.ts pins that src never touches the learn
 *   lane's runtime) and is pinned structurally by the compile-time
 *   LearnCompositionBinding assertion below: a real learn plan fits the
 *   synthesizer's plan slot as-is.
 * - THE IDENTITY LAW: the 'cgraph_' prefix is the library lane's frozen
 *   identity (packages/library/src/compat-graph.ts — the compat graph's
 *   graphSha256). THIS lane mints 'pgraph_' ids — a DISTINCT prefix in
 *   the repo's pkg_ / arch_ / comp_ / tcls_ / cgraph_ discipline; a
 *   re-use of 'cgraph_' would be an identity fork, never done here.
 *
 * THE EDGE VOCABULARY (frozen v0.1): 'targets' — exactly one edge from
 * the target node to each selected component (the v0.1 law). The
 * 'depends' kind is RESERVED for the cgraph-edge binding in a LATER
 * factory lane: the compat graph's frozen pairwise verdicts will bind
 * component-to-component edges then. It is documented here, part of the
 * frozen vocabulary, and NEVER minted by this module.
 *
 * THE LAWS (the 060–086 house discipline, binding):
 * - Fail closed: synthesis errors are collected — ALL of them, each
 *   naming its field and carrying the OBSERVED VALUE — into
 *   { ok: false, errors }; results, never exceptions; nothing is
 *   synthesized from partial data.
 * - Derived, never guessed: exactly ONE target node (the
 *   classification's own tcls_ id, kind 'target'); one component node
 *   per selected entry (the plan's manifest ids, carried VERBATIM, kind
 *   'component'); exactly one 'targets' edge per selected component;
 *   nodeCount and edgeCount are MEASURED (nodes.length / edges.length),
 *   never asserted from the plan's `considered` or `graphEdgeCount`.
 * - The graph identity law: a graph never carries two nodes with one id
 *   — a DUPLICATE selected manifest id is a named error, and a selected
 *   id equal to the classification's own id is a named error (the
 *   target is never also a component).
 * - The empty selection is honest: zero selected → exactly the target
 *   node, zero edges, nodeCount 1, edgeCount 0 — a valid graph, never
 *   an error, never a guess.
 * - Determinism: no clock (synthesizedAt is CALLER-injected), no
 *   randomness, no network, no filesystem; the synthesizer never
 *   mutates its inputs. The graph id is content-addressed — 'pgraph_' +
 *   sha256Hex(canonicalJson(graph minus id minus synthesizedAt)) — so
 *   synthesizing the same inputs twice yields deep-equal graphs with
 *   identical ids, and a different caller clock never changes the id
 *   (the 085 tcls_ discipline). Async because the id hashes (sha256Hex
 *   over the canonical graph body — the classifyTarget/planComposition
 *   precedent).
 * - Sorted, canonical orders: nodes sorted by id; edges sorted by
 *   (from, to, kind) — the deterministic orders, independent of the
 *   plan's selection order.
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';
import type { CompositionPlan } from '@clapp/learn';

import { TARGET_CLASS_VERSION } from './target-classification';
import type { TargetClassification } from './target-classification';

// ---- internal shared helpers (module-level; NOT re-exported by src/index.ts) ------

/** Plain-object guard (arrays are NOT objects here — the house helper). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Human preview of an unknown value, for error messages. */
function preview(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'undefined') return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---- the package-graph contract v0.1 ------------------------------------------------

/** The package-graph contract version (bumps only via a tech-lead declaration wave). */
export const PACKAGE_GRAPH_VERSION = '0.1';

/**
 * The learn-lane composition contract version this synthesizer binds
 * (frozen — a mismatch is a named error). Pinned as a literal constant of
 * THIS lane because @clapp/learn is imported TYPE-ONLY (the no-fork law):
 * no runtime value is ever consumed from the learn lane.
 */
export const COMPOSITION_BINDING_VERSION = '0.1';

/**
 * The graph-id prefix — THIS lane's frozen proposal in the `pkg_ /
 * `arch_` / `comp_` / `tcls_` / `cgraph_` prefix discipline: `pgraph_` +
 * 64 lowercase hex chars. The library lane's `cgraph_` is a DISTINCT,
 * frozen identity this lane never re-uses (a re-use would be an identity
 * fork). Changing the prefix changes every minted graph id and requires
 * a contract version bump.
 */
const PACKAGE_GRAPH_ID_PREFIX = 'pgraph_';

/** The node-kind vocabulary (frozen v0.1: the target + the selected components). */
export type PackageGraphNodeKind = 'target' | 'component';

/**
 * The edge-kind vocabulary (frozen v0.1: 'targets' now; 'depends' is
 * RESERVED for the cgraph-edge binding in a later factory lane —
 * documented here, never minted by this module).
 */
export type PackageGraphEdgeKind = 'targets' | 'depends';

/** One node of the synthesized graph. */
export interface PackageGraphNode {
  /** The node's id: the target's tcls_ classification id, or a selected component's manifest id. */
  id: string;
  kind: PackageGraphNodeKind;
}

/** One edge of the synthesized graph. */
export interface PackageGraphEdge {
  /** The edge's source node id. */
  from: string;
  /** The edge's target node id. */
  to: string;
  kind: PackageGraphEdgeKind;
}

/** The synthesized package graph — what the codegen lane walks. */
export interface PackageGraph {
  /** PACKAGE_GRAPH_VERSION ('0.1'). */
  packageGraphVersion: string;
  /**
   * Content-addressed: 'pgraph_' + sha256Hex(canonicalJson(graph minus id
   * minus synthesizedAt)) — deterministic, no uuid, no clock. Excluding
   * synthesizedAt means a different caller clock never changes the id
   * (the 085 tcls_ discipline).
   */
  id: string;
  /** The source classification's id, carried VERBATIM (the provenance binding). */
  classificationId: string;
  /** The source composition plan's id, carried VERBATIM. */
  planId: string;
  /** Sorted by id (the deterministic order). */
  nodes: PackageGraphNode[];
  /** Sorted by (from, to, kind) — the deterministic order. */
  edges: PackageGraphEdge[];
  /** MEASURED: nodes.length (never asserted from the plan's shape). */
  nodeCount: number;
  /** MEASURED: edges.length (never the plan's graphEdgeCount). */
  edgeCount: number;
  /** RFC3339 — CALLER-injected; the synthesizer never reads a clock. */
  synthesizedAt: string;
}

/** Fail-closed synthesis: a result, never an exception. */
export type PackageGraphResult =
  | { ok: true; graph: PackageGraph }
  | { ok: false; errors: string[] };

/**
 * The TYPE-ONLY seam pin for the classification (the 086
 * ResolvedClassificationBinding precedent, over this lane's two consumed
 * fields): a real resolved CLAPP-085 TargetClassification fits the
 * synthesizer's classification slot as-is. If the classification
 * contract ever breaks its frozen v0.1 shape, this line stops compiling
 * — the consumed seam is checked, not conventional.
 */
export type GraphClassificationBinding = StaticAssign<
  Pick<TargetClassification, 'targetVersion' | 'id'>,
  { targetVersion: string; id: string }
>;

/**
 * The TYPE-ONLY seam pin for the learn plan (the 085
 * LearnArchetypeBinding precedent): the frozen CompositionPlan, picked to
 * EXACTLY the three fields this lane consumes, is structurally assignable
 * to the duck-validation slot below — a real learn plan fits the
 * synthesizer's plan slot as-is. If the learn lane ever breaks its
 * frozen v0.1 shape, this line stops compiling — the binding is a
 * checked seam, not a convention.
 */
export type LearnCompositionBinding = StaticAssign<
  Pick<CompositionPlan, 'compositionVersion' | 'id' | 'selected'>,
  { compositionVersion: string; id: string; selected: Array<{ id: string }> }
>;

/** Compile-time assignability assertion: TFits must extend TSlot. */
type StaticAssign<TFits extends TSlot, TSlot> = TFits;

// ---- the package-graph synthesizer --------------------------------------------------

/**
 * Synthesizes ONE package graph from a CLAPP-085 target classification
 * and a CLAPP-063 learn composition plan — the graph the codegen lane
 * walks. Async because the graph identity hashes (sha256Hex over the
 * canonical graph body — the classifyTarget/planComposition precedent).
 *
 * Fail closed: a non-object classification, a targetVersion other than
 * TARGET_CLASS_VERSION ('0.1'), a non-object plan, a compositionVersion
 * other than '0.1' (the learn binding — the observed value is named),
 * an empty plan id, a `selected` that is not an array of objects with
 * non-empty id strings, a DUPLICATE selected id (the graph identity
 * law), a selected id equal to the classification's own id (the target
 * is never also a component), or an empty synthesizedAt is a collected,
 * field-named error carrying the observed value — ALL errors, never
 * just the first; results, never exceptions; nothing is synthesized
 * from partial data. Extra classification/plan fields are the caller's
 * business — the synthesizer validates exactly the fields it reads.
 *
 * On success the graph is DERIVED, never guessed: exactly one target
 * node (the classification's own tcls_ id), one component node per
 * selected entry (the plan's manifest ids carried VERBATIM), exactly
 * one 'targets' edge per selected component (no 'depends' edges are
 * ever minted — the kind is reserved for the later cgraph-edge lane),
 * and nodeCount/edgeCount MEASURED from the derived arrays. The empty
 * selection is honest: zero selected → the target node alone, zero
 * edges, nodeCount 1, edgeCount 0.
 *
 * Deterministic: the same classification + plan + timestamp synthesize
 * a deep-equal graph with an identical 'pgraph_' id; a different caller
 * clock never moves the id (synthesizedAt is excluded from the minting
 * body). The synthesizer never mutates its inputs and touches nothing
 * but the classification, plan and timestamp given.
 */
export async function synthesizePackageGraph(
  classification: unknown,
  plan: unknown,
  synthesizedAt: string,
): Promise<PackageGraphResult> {
  const errors: string[] = [];

  // ---- caller-injected synthesis time — the synthesizer never reads a clock ----
  if (typeof synthesizedAt !== 'string' || synthesizedAt.length === 0) {
    errors.push(
      `synthesizedAt: expected a non-empty string (caller-injected — the synthesizer never reads a clock), got ${preview(synthesizedAt)}`,
    );
  }

  // ---- the classification admission (a plain object) ----
  let classificationId: string | undefined;
  if (!isObject(classification)) {
    errors.push(
      `classification: expected an object (a resolved CLAPP-085 TargetClassification: targetVersion, id), got ${preview(classification)}`,
    );
  } else {
    // The bound contract version — a mismatch is a named error, never a guess.
    const targetVersion = classification['targetVersion'];
    if (targetVersion !== TARGET_CLASS_VERSION) {
      errors.push(
        `classification.targetVersion: expected '0.1' (TARGET_CLASS_VERSION — the frozen classification contract this lane consumes; a mismatch is a named error, never a guess), got ${preview(targetVersion)}`,
      );
    }

    // The tcls_ provenance, a non-empty string.
    const id = classification['id'];
    if (typeof id !== 'string' || id.length === 0) {
      errors.push(
        `classification.id: expected a non-empty string (the source classification's tcls_ identity — carried verbatim as the provenance binding), got ${preview(id)}`,
      );
    } else {
      classificationId = id;
    }
  }

  // ---- the plan admission (the learn lane's CompositionPlan, consumed as DATA) ----
  let planId: string | undefined;
  let selectedIds: string[] | undefined;
  if (!isObject(plan)) {
    errors.push(
      `plan: expected an object (the learn lane's CompositionPlan consumed as DATA: compositionVersion, id, selected), got ${preview(plan)}`,
    );
  } else {
    // The bound learn contract version — a mismatch is a named error
    // naming the observed value (the 085 archetypeVersion law).
    const compositionVersion = plan['compositionVersion'];
    if (compositionVersion !== COMPOSITION_BINDING_VERSION) {
      errors.push(
        `plan.compositionVersion: expected '0.1' (COMPOSITION_BINDING_VERSION — the frozen learn composition contract this synthesizer binds; a mismatch is a named error, never a guess), got ${preview(compositionVersion)}`,
      );
    }

    // The comp_ provenance, a non-empty string.
    const id = plan['id'];
    if (typeof id !== 'string' || id.length === 0) {
      errors.push(
        `plan.id: expected a non-empty string (the source plan's comp_ identity — carried verbatim as the provenance binding), got ${preview(id)}`,
      );
    } else {
      planId = id;
    }

    // The selected components: an array of objects with non-empty id strings.
    const rawSelected = plan['selected'];
    if (!Array.isArray(rawSelected)) {
      errors.push(
        `plan.selected: expected an array of selected-component objects (the plan's greedy rank order — the manifest ids this lane carries verbatim), got ${preview(rawSelected)}`,
      );
    } else {
      const ids: string[] = [];
      let malformed = false;
      rawSelected.forEach((entry: unknown, index: number) => {
        if (!isObject(entry)) {
          malformed = true;
          errors.push(
            `plan.selected[${index}]: expected an object with a non-empty id string (a selected component — the manifest id is carried verbatim), got ${preview(entry)}`,
          );
          return;
        }
        const entryId = entry['id'];
        if (typeof entryId !== 'string' || entryId.length === 0) {
          malformed = true;
          errors.push(
            `plan.selected[${index}].id: expected a non-empty string (the selected component's manifest id — carried verbatim), got ${preview(entryId)}`,
          );
          return;
        }
        ids.push(entryId);
      });
      if (!malformed) {
        selectedIds = ids;
      }
    }
  }

  // ---- the graph identity law (checked only over admitted data) ----
  // A graph never carries two nodes with one id: a DUPLICATE selected
  // manifest id is a named error, and a selected id equal to the
  // classification's own id is a named error (the target is never also
  // a component — the tcls_ and pkg_ identities never collide).
  if (classificationId !== undefined && selectedIds !== undefined) {
    const seen = new Set<string>();
    selectedIds.forEach((id, index) => {
      if (seen.has(id)) {
        errors.push(
          `plan.selected[${index}].id: the manifest id ${preview(id)} is DUPLICATED — a package graph never carries two nodes with one id (the identity law; the corpus admission already refuses duplicate manifest ids, so a real plan never reaches this error)`,
        );
      }
      seen.add(id);
      if (id === classificationId) {
        errors.push(
          `plan.selected[${index}].id: the manifest id equals the classification's own id ${preview(id)} — the target is never also a component (the identity law; one id, one node, one kind)`,
        );
      }
    });
  }

  // ---- fail closed: nothing is synthesized unless every field admitted ----
  if (
    errors.length > 0 ||
    classificationId === undefined ||
    planId === undefined ||
    selectedIds === undefined
  ) {
    return { ok: false, errors };
  }

  // ---- the DERIVED graph (never guessed) ----
  // Exactly one target node — the classification's own id; one component
  // node per selected entry — the plan's manifest ids carried VERBATIM.
  // Nodes sorted by id, edges by (from, to, kind): the deterministic
  // orders, independent of the plan's selection order.
  const targetNode: PackageGraphNode = { id: classificationId, kind: 'target' };
  const nodes: PackageGraphNode[] = [
    targetNode,
    ...selectedIds.map((id): PackageGraphNode => ({ id, kind: 'component' })),
  ].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  // v0.1: exactly one 'targets' edge per selected component — the
  // target targets every selected component. No 'depends' edges are
  // ever minted here (the kind is reserved for the later cgraph-edge
  // lane; the module header documents the reservation).
  const edges: PackageGraphEdge[] = selectedIds
    .map((id): PackageGraphEdge => ({ from: classificationId, to: id, kind: 'targets' }))
    .sort((left, right) => {
      if (left.from !== right.from) {
        return left.from < right.from ? -1 : 1;
      }
      if (left.to !== right.to) {
        return left.to < right.to ? -1 : 1;
      }
      return left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0;
    });

  const nodeCount = nodes.length; // MEASURED
  const edgeCount = edges.length; // MEASURED — never the plan's graphEdgeCount

  // ---- the content-addressed graph identity ----
  // The graph MINUS its id and synthesizedAt is the minting input (the
  // tcls_ / comp_ discipline with the clock excluded): same id ⇔
  // identical canonical graph bytes — any measured change (a selected
  // component, an edge, a count, the provenance ids) moves the id,
  // while a different caller clock never does.
  const graphBody: Omit<PackageGraph, 'id' | 'synthesizedAt'> = {
    packageGraphVersion: PACKAGE_GRAPH_VERSION,
    classificationId,
    planId,
    nodes,
    edges,
    nodeCount,
    edgeCount,
  };

  // The last line of defense (the 060/061/062 precedent): a
  // canonicalization refusal is a NAMED error — never an escaped
  // exception. (The body is built from validated strings, measured
  // integers and fresh arrays, so this cannot fire in practice — the
  // discipline is kept unconditional anyway.)
  let canonical: string;
  try {
    canonical = canonicalJson(graphBody);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [
        `package-graph minting: the derived graph is not canonical-JSON serializable (${detail})`,
      ],
    };
  }
  const id = `${PACKAGE_GRAPH_ID_PREFIX}${await sha256Hex(canonical)}`;

  return { ok: true, graph: { ...graphBody, id, synthesizedAt } };
}
