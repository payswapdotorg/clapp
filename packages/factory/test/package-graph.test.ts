// CLAPP-087 — the package-graph synthesis tests (the P9 third lane —
// Worker 1, the factory lane's owner).
//
// Fixtures: test/fixtures/graphs.ts (the frozen v0.1 CLAPP-085
// TargetClassification shape carrying a REAL tcls_ id + full frozen v0.1
// learn CompositionPlan shapes — three selected, empty, duplicate,
// self-target, an extra mutation component — with opaque comp_/pkg_
// fixture ids, the 085 arch_-fixture precedent) and the malformed*
// builders over them. The eight named tests cover the packet's axes:
// the fail-closed synthesizer (every malformation named with its
// observed value), the single 'target' node bound to the tcls_
// classification id, the selected components as id-sorted 'component'
// nodes (ids verbatim), the one-'targets'-edge-per-component law with
// MEASURED counts (never the plan's graphEdgeCount), the
// content-addressed deterministic 'pgraph_' ids (recomputed
// independently here from the same core hash + canonical serializer;
// NOT the library lane's 'cgraph_' — the identity distinction; a
// changed plan moves the id), the verbatim classificationId/planId
// provenance, the identity law (duplicate selected ids and the
// target-never-also-a-component refused; the empty selection honest),
// and the import-discipline pin (the no-fork law over the exact
// four-file src list: @clapp/core + @clapp/observe at RUNTIME,
// @clapp/learn TYPE-ONLY, no other packages).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import { TARGET_CLASS_VERSION } from '../src/target-classification';

import {
  COMPOSITION_BINDING_VERSION,
  PACKAGE_GRAPH_VERSION,
  synthesizePackageGraph,
} from '../src/package-graph';
import type { PackageGraph } from '../src/package-graph';

import {
  DUPLICATE_SELECTION_PLAN,
  EMPTY_SELECTION_PLAN,
  EXTRA_SELECTED_COMPONENT,
  GRAPH_CLASSIFICATION,
  SELF_TARGET_SELECTION_PLAN,
  SYNTHESIZED_AT_A,
  SYNTHESIZED_AT_B,
  THREE_COMPONENT_PLAN,
  malformedClassification,
  malformedPlan,
} from './fixtures/graphs';

/** Synthesize and be loud about it — a fixture failure must not pass silently. */
async function synthesize(
  classification: unknown,
  plan: unknown,
  synthesizedAt: string = SYNTHESIZED_AT_A,
): Promise<PackageGraph> {
  const result = await synthesizePackageGraph(classification, plan, synthesizedAt);
  if (!result.ok) {
    throw new Error(`synthesis failed: ${result.errors.join('; ')}`);
  }
  return result.graph;
}

// ---- the import-discipline test's machinery (module level, like the siblings') ------

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

describe('CLAPP-087 — package-graph synthesis (the P9 factory third lane)', () => {
  test('the graph synthesizer is fail-closed with named errors for every malformation', async () => {
    // The valid fixtures pass — and the fixtures really bind the frozen
    // contracts this synthesizer consumes (the 085 classification
    // contract + the 086 learn composition binding).
    const valid = await synthesizePackageGraph(GRAPH_CLASSIFICATION, THREE_COMPONENT_PLAN, SYNTHESIZED_AT_A);
    expect(valid.ok).toBe(true);
    expect(GRAPH_CLASSIFICATION.targetVersion).toBe(TARGET_CLASS_VERSION);
    expect(THREE_COMPONENT_PLAN.compositionVersion).toBe(COMPOSITION_BINDING_VERSION);
    if (valid.ok) {
      expect(valid.graph.packageGraphVersion).toBe(PACKAGE_GRAPH_VERSION);
    }

    // A non-object classification is named (the admission shape itself).
    const notAnObject = await synthesizePackageGraph('not-a-classification', THREE_COMPONENT_PLAN, SYNTHESIZED_AT_A);
    expect(notAnObject.ok).toBe(false);
    if (!notAnObject.ok) {
      expect(notAnObject.errors.some((error) => error.startsWith('classification:'))).toBe(true);
    }

    // Every field malformation refuses, naming its field AND the observed value.
    const cases: Array<{ classification: unknown; plan: unknown; names: string[] }> = [
      {
        classification: null,
        plan: THREE_COMPONENT_PLAN,
        names: ['classification:'],
      },
      {
        classification: malformedClassification({ targetVersion: '0.9' }),
        plan: THREE_COMPONENT_PLAN,
        names: ['classification.targetVersion', '"0.9"'],
      },
      {
        classification: malformedClassification({ id: '' }),
        plan: THREE_COMPONENT_PLAN,
        names: ['classification.id'],
      },
      {
        classification: GRAPH_CLASSIFICATION,
        plan: 'not-a-plan',
        names: ['plan:'],
      },
      {
        classification: GRAPH_CLASSIFICATION,
        plan: malformedPlan({ compositionVersion: '0.9' }),
        names: ['plan.compositionVersion', '"0.9"'],
      },
      {
        classification: GRAPH_CLASSIFICATION,
        plan: malformedPlan({ id: '' }),
        names: ['plan.id'],
      },
      {
        classification: GRAPH_CLASSIFICATION,
        plan: malformedPlan({ selected: 'not-an-array' }),
        names: ['plan.selected'],
      },
      {
        classification: GRAPH_CLASSIFICATION,
        plan: malformedPlan({
          selected: [...THREE_COMPONENT_PLAN.selected.slice(0, 2), 'not-an-object'],
        }),
        names: ['plan.selected[2]'],
      },
      {
        classification: GRAPH_CLASSIFICATION,
        plan: malformedPlan({
          selected: [...THREE_COMPONENT_PLAN.selected.slice(0, 2), { id: '' }],
        }),
        names: ['plan.selected[2].id', '""'],
      },
    ];

    for (const { classification, plan, names } of cases) {
      const result = await synthesizePackageGraph(classification, plan, SYNTHESIZED_AT_A);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        for (const name of names) {
          expect(result.errors.some((error) => error.includes(name))).toBe(true);
        }
      }
    }

    // An empty synthesizedAt (the caller-injected clock parameter) is named.
    const emptyTime = await synthesizePackageGraph(GRAPH_CLASSIFICATION, THREE_COMPONENT_PLAN, '');
    expect(emptyTime.ok).toBe(false);
    if (!emptyTime.ok) {
      expect(emptyTime.errors.some((error) => error.startsWith('synthesizedAt:'))).toBe(true);
    }

    // Three bad inputs at once — EVERY error is collected, never just the first.
    const allBad = await synthesizePackageGraph(
      malformedClassification({ targetVersion: '0.9' }),
      malformedPlan({ compositionVersion: '0.9' }),
      '',
    );
    expect(allBad.ok).toBe(false);
    if (!allBad.ok) {
      expect(allBad.errors.some((error) => error.includes('classification.targetVersion'))).toBe(true);
      expect(allBad.errors.some((error) => error.includes('plan.compositionVersion'))).toBe(true);
      expect(allBad.errors.some((error) => error.startsWith('synthesizedAt:'))).toBe(true);
    }

    // Fail closed, proven: every call above RESOLVED (never threw) and
    // returned { ok: false } — the awaits resolving are themselves the
    // no-exceptions evidence.
  });

  test("the target node binds the classification's id — exactly one, kind 'target'", async () => {
    const graph = await synthesize(GRAPH_CLASSIFICATION, THREE_COMPONENT_PLAN);

    // Exactly ONE 'target' node — the classification's own tcls_ id,
    // carried verbatim (the fixture's id is the real 085-minted digest).
    const targets = graph.nodes.filter((node) => node.kind === 'target');
    expect(targets).toEqual([{ id: GRAPH_CLASSIFICATION.id, kind: 'target' }]);
    expect(GRAPH_CLASSIFICATION.id).toMatch(/^tcls_[0-9a-f]{64}$/);
  });

  test("the selected components become nodes — ids verbatim, sorted, kind 'component'", async () => {
    const graph = await synthesize(GRAPH_CLASSIFICATION, THREE_COMPONENT_PLAN);

    // Three selected → exactly three 'component' nodes, the plan's
    // manifest ids carried VERBATIM (same values, nothing minted).
    const componentIds = graph.nodes
      .filter((node) => node.kind === 'component')
      .map((node) => node.id);
    expect(componentIds).toEqual([...THREE_COMPONENT_PLAN.selected.map((entry) => entry.id)].sort());
    expect(graph.nodes.filter((node) => node.kind === 'component').length).toBe(3);

    // The full node list is sorted by id (the deterministic order),
    // and the target + the components are ALL the nodes (1 + 3 = 4).
    const nodeIds = graph.nodes.map((node) => node.id);
    expect(nodeIds).toEqual([...nodeIds].sort());
    expect(graph.nodes.length).toBe(1 + THREE_COMPONENT_PLAN.selected.length);
    expect(graph.nodeCount).toBe(graph.nodes.length);
  });

  test('the target targets every selected component — one edge each, measured', async () => {
    const graph = await synthesize(GRAPH_CLASSIFICATION, THREE_COMPONENT_PLAN);

    // Three selected → exactly three 'targets' edges, one per component,
    // every one FROM the tcls_ id — sorted by (from, to, kind).
    expect(graph.edges).toEqual(
      THREE_COMPONENT_PLAN.selected
        .map((entry) => ({ from: GRAPH_CLASSIFICATION.id, to: entry.id, kind: 'targets' }))
        .sort((left, right) => (left.to < right.to ? -1 : left.to > right.to ? 1 : 0)),
    );

    // edgeCount is MEASURED (edges.length, 3) — never the plan's own
    // graphEdgeCount (10, the induced compat subgraph's pair count) or
    // its considered (5): the fixture deliberately diverges so the pin
    // bites.
    expect(graph.edgeCount).toBe(3);
    expect(graph.edgeCount).toBe(graph.edges.length);
    expect(graph.edgeCount).not.toBe(THREE_COMPONENT_PLAN.graphEdgeCount);
    expect(THREE_COMPONENT_PLAN.graphEdgeCount).toBe(10);

    // v0.1 mints only 'targets' edges — a 'depends' edge is NEVER
    // minted here (the kind is reserved for the later cgraph-edge lane).
    expect(graph.edges.every((edge) => edge.kind === 'targets')).toBe(true);
  });

  test('ids are content-addressed and deterministic — same inputs, same id; a changed plan, a different id', async () => {
    const first = await synthesize(GRAPH_CLASSIFICATION, THREE_COMPONENT_PLAN);
    const second = await synthesize(GRAPH_CLASSIFICATION, THREE_COMPONENT_PLAN);

    // The same inputs synthesize deep-equal graphs, with the 'pgraph_'
    // prefix (64 lowercase hex) — and NOT the library lane's 'cgraph_'
    // (the identity distinction: a re-use would be an identity fork).
    expect(second).toEqual(first);
    expect(first.id).toMatch(/^pgraph_[0-9a-f]{64}$/);
    expect(first.id.startsWith('cgraph_')).toBe(false);

    // The id is RECOMPUTED independently here — the same core hash over
    // the same canonical serialization of the graph body (every field
    // except id and synthesizedAt) — and must equal the minted one.
    const expectedId = `pgraph_${await sha256Hex(
      canonicalJson({
        packageGraphVersion: first.packageGraphVersion,
        classificationId: first.classificationId,
        planId: first.planId,
        nodes: first.nodes,
        edges: first.edges,
        nodeCount: first.nodeCount,
        edgeCount: first.edgeCount,
      }),
    )}`;
    expect(first.id).toBe(expectedId);

    // A different caller clock never changes the id — synthesizedAt is
    // EXCLUDED from the minting body (the 085 tcls_ discipline).
    const clockShifted = await synthesize(GRAPH_CLASSIFICATION, THREE_COMPONENT_PLAN, SYNTHESIZED_AT_B);
    expect(clockShifted.id).toBe(first.id);
    expect(clockShifted.synthesizedAt).toBe(SYNTHESIZED_AT_B);
    expect({ ...clockShifted, synthesizedAt: first.synthesizedAt }).toEqual(first);

    // A changed plan (the selected array mutated — one extra component)
    // is a MEASURED change that moves the id.
    const changedPlan = {
      ...THREE_COMPONENT_PLAN,
      selected: [...THREE_COMPONENT_PLAN.selected, EXTRA_SELECTED_COMPONENT],
    };
    const changed = await synthesize(GRAPH_CLASSIFICATION, changedPlan);
    expect(changed.id).not.toBe(first.id);
    expect(changed.nodeCount).toBe(first.nodeCount + 1);
    expect(changed.edgeCount).toBe(first.edgeCount + 1);

    // The synthesizer never mutates its inputs — the plan and the
    // classification are byte-identical after every synthesis above.
    expect(THREE_COMPONENT_PLAN.selected.length).toBe(3);
    expect(THREE_COMPONENT_PLAN.selected.map((entry) => entry.id)).toEqual([
      'pkg_fixture-router',
      'pkg_fixture-forms',
      'pkg_fixture-api-client',
    ]);
  });

  test('the provenance is carried verbatim — classificationId and planId', async () => {
    const graph = await synthesize(GRAPH_CLASSIFICATION, THREE_COMPONENT_PLAN);

    // The tcls_ classification id and the comp_ plan id, carried
    // VERBATIM — character for character, never recomputed.
    expect(graph.classificationId).toBe(GRAPH_CLASSIFICATION.id);
    expect(graph.planId).toBe(THREE_COMPONENT_PLAN.id);
    expect(graph.classificationId).toMatch(/^tcls_[0-9a-f]{64}$/);
    expect(graph.planId.startsWith('comp_')).toBe(true);

    // The caller-injected clock is carried verbatim too.
    expect(graph.synthesizedAt).toBe(SYNTHESIZED_AT_A);
  });

  test('the identity law and the empty selection are honest', async () => {
    // A DUPLICATE selected manifest id → the named error (a graph never
    // carries two nodes with one id).
    const duplicate = await synthesizePackageGraph(GRAPH_CLASSIFICATION, DUPLICATE_SELECTION_PLAN, SYNTHESIZED_AT_A);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.errors.some((error) => error.includes('DUPLICATED'))).toBe(true);
      expect(duplicate.errors.some((error) => error.includes('pkg_fixture-router'))).toBe(true);
    }

    // A selected id equal to the classification's own id → the named
    // error (the target is never also a component).
    const selfTarget = await synthesizePackageGraph(GRAPH_CLASSIFICATION, SELF_TARGET_SELECTION_PLAN, SYNTHESIZED_AT_A);
    expect(selfTarget.ok).toBe(false);
    if (!selfTarget.ok) {
      expect(selfTarget.errors.some((error) => error.includes('never also a component'))).toBe(true);
      expect(selfTarget.errors.some((error) => error.includes(GRAPH_CLASSIFICATION.id))).toBe(true);
    }

    // Zero selected → the honest empty graph: exactly the target node,
    // zero edges, nodeCount 1, edgeCount 0 — never an error, never a
    // guess — with the provenance carried and a valid pgraph_ id.
    const empty = await synthesize(GRAPH_CLASSIFICATION, EMPTY_SELECTION_PLAN);
    expect(empty.nodes).toEqual([{ id: GRAPH_CLASSIFICATION.id, kind: 'target' }]);
    expect(empty.edges).toEqual([]);
    expect(empty.nodeCount).toBe(1);
    expect(empty.edgeCount).toBe(0);
    expect(empty.classificationId).toBe(GRAPH_CLASSIFICATION.id);
    expect(empty.planId).toBe(EMPTY_SELECTION_PLAN.id);
    expect(empty.id).toMatch(/^pgraph_[0-9a-f]{64}$/);
  });

  test('the package imports only frozen contracts — the no-fork law is pinned', () => {
    const packageRoot = dirname(import.meta.dir); // packages/factory (one level above test/)

    // ---- 1. the exact src file list (the delivered surface) ----
    // CLAPP-087 grew the surface to four files (package-graph is this
    // package's third component); the pin stays exact — the living
    // list, per the security imports.test.ts precedent.
    // CLAPP-088 grew the surface to five files (multi-pass-repair is
    // this package's fourth component); the pin stays exact — the living list.
    const srcFiles = listTsFiles(join(packageRoot, 'src')).sort();
    expect(srcFiles.map((file) => file.slice(packageRoot.length + 1))).toEqual([
      'src/exploration-budgets.ts',
      'src/index.ts',
      'src/multi-pass-repair.ts',
      'src/package-graph.ts',
      'src/target-classification.ts',
    ]);

    const runtimeAllowed = new Set(['@clapp/core', '@clapp/observe']);
    const typeOnlyAllowed = new Set(['@clapp/learn']);
    const violations: string[] = [];

    // ---- 2. src/** — @clapp/core + @clapp/observe at RUNTIME;
    //         @clapp/learn TYPE-ONLY; no other packages ----
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
            `${display}: undeclared workspace dependency ${JSON.stringify(specifier)} — the dependency set is @clapp/core + @clapp/observe (runtime) and @clapp/learn (type-only)`,
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
