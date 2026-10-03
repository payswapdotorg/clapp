/**
 * @clapp/linux — the Linux observation adapter (CLAPP-081, the P8
 * second platform — the first-executing of the five platform
 * components).
 *
 * docs/WORK_ITEMS.md P8: each platform implements an observation
 * adapter. THIS MODULE IS THE LINUX ONE: `observeLinuxScreen` captures
 * one screen's view tree through the host seam and returns the tree's
 * MEASURED facts — the digest, the node count, the observed depth — as
 * a result, never an exception (validation failures) and never a
 * synthetic value (host failures).
 *
 * THE HOST-SEAM LAW (the honest boundary): everything environment-
 * specific enters through ONE duck-typed seam — LinuxObservationHost
 * ("an object with a callable captureScreen()"). The CONTRACTS are this
 * lane's deliverable; the tests fake the seam. Real X11 (XCB) / Wayland
 * / AT-SPI-over-D-Bus accessibility-tree bindings are deployment scope
 * (later lanes) — never this module.
 *
 * THE AT-SPI LAW (the honest refusal): v0.1 observes the Linux desktop
 * through the AT-SPI accessibility bus or not at all. An environment
 * whose accessibilityBus is 'none' (a VALID descriptor — the honest
 * no-bus machine) REFUSES observation: a NAMED error, nothing observed,
 * and the host is NEVER CALLED (no bus, no capture — a capture without
 * a bus would be fabricated evidence).
 *
 * THE BUDGET LAW: the captured tree's depth must stay within the
 * environment's maxHierarchyDepth — an over-depth tree is a NAMED error
 * and NOTHING is observed. Depth counts the root as 1.
 *
 * THE MEASUREMENT LAW: screenDigest, nodeCount, and observedDepth are
 * MEASURED from the captured tree — never asserted, never fabricated:
 *   - screenDigest = sha256Hex(canonicalJson(tree)) — the SAME core
 *     hash and the SAME canonical serializer every other CLAPP lane
 *     uses (@clapp/core sha256Hex + @clapp/observe canonicalJson — the
 *     package's two RUNTIME dependencies, by design);
 *   - nodeCount = the traversal count of every node, at every depth;
 *   - observedDepth = the deepest node's level (root = 1).
 *
 * THE LOUD-HOST LAW: a THROWING host propagates loudly (the caller's
 * failure is the caller's — never swallowed, never converted into a
 * synthetic result — the replay-benchmark precedent). canonicalJson's
 * deliberate throw on non-canonicalizable payloads (class instances,
 * undefined, non-plain objects) is inherited loud behavior: the observe
 * package's law, unchanged here.
 *
 * THE NO-FORK LAW (the P8 cardinal law): LinuxViewNode is a
 * SCREEN-LEVEL capture shape local to this adapter — the Behavioral IR
 * (@clapp/ir screen_/comp_/trans_ ids) stays authoritative; this module
 * references, never redefines, IR vocabulary.
 *
 * Discipline (binding — the 070..075 house rules): no clock, no
 * randomness, no network, no filesystem, no global state; the module
 * never mutates its inputs; results, never exceptions (except the
 * loud-host law above).
 */

import { sha256Hex } from '@clapp/core';
import { canonicalJson } from '@clapp/observe';

import { validateLinuxEnvironment } from './environment';
import type { LinuxEnvironment } from './environment';

// ---- the capture shapes ------------------------------------------------------------

/** One captured UI node — the Linux AT-SPI accessibility-tree equivalence (a SCREEN-LEVEL shape; the IR stays authoritative). */
export interface LinuxViewNode {
  /** The node's accessible id (e.g. 'submit-button' — non-empty). */
  resourceId: string;
  /** The node's class/role name (non-empty, e.g. 'push button' — the AT-SPI role). */
  className: string;
  /** The node's text (may be an empty string). */
  text: string;
  /** The node's content description (may be an empty string). */
  contentDescription: string;
  /** The node's children (any depth up to the environment's maxHierarchyDepth). */
  children: LinuxViewNode[];
}

// ---- the host seam (the honest boundary) -------------------------------------------

/** The observation host seam: everything environment-specific enters HERE (duck-typed — the test fakes it). */
export interface LinuxObservationHost {
  /** Capture the current screen's view tree. */
  captureScreen(): Promise<LinuxViewNode>;
}

/** One observation — the captured tree's MEASURED facts. */
export interface LinuxObservation {
  /** The descriptor version the observation ran under (LINUX_ENVIRONMENT_VERSION). */
  environmentVersion: string;
  /** sha256Hex(canonicalJson(tree)) — the capture's digest (MEASURED). */
  screenDigest: string;
  /** The node count (MEASURED, at every depth). */
  nodeCount: number;
  /** The max observed depth (MEASURED; the root is depth 1). */
  observedDepth: number;
}

/** The observation adapter's fail-closed result (the house shape). */
export type LinuxObservationResult =
  | { ok: true; observation: LinuxObservation }
  | { ok: false; errors: string[] };

// ---- internal helpers (module-level; NOT re-exported by src/index.ts) --------------

/** Duck-typed host-seam guard: an object with a callable captureScreen. */
function isObservationHost(host: unknown): host is LinuxObservationHost {
  return (
    typeof host === 'object' &&
    host !== null &&
    typeof (host as Record<string, unknown>).captureScreen === 'function'
  );
}

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

/**
 * Fail-closed view-tree validation, node by node: resourceId and
 * className non-empty strings; text and contentDescription strings (may
 * be empty); children an array; and THE BUDGET LAW — a node deeper than
 * the environment's maxHierarchyDepth is a NAMED error (the subtree
 * below it is not walked: the budget is already blown). Every violation
 * is collected and named with the node's depth and the observed value.
 */
function validateViewTree(
  node: unknown,
  maxHierarchyDepth: number,
  depth: number,
  errors: string[],
): void {
  if (!isObject(node)) {
    errors.push(`view node at depth ${depth} must be an object (observed: ${preview(node)})`);
    return;
  }
  if (depth > maxHierarchyDepth) {
    errors.push(
      `view tree depth ${depth} exceeds the environment's maxHierarchyDepth ${maxHierarchyDepth} (the observation budget)`,
    );
    return;
  }
  if (typeof node.resourceId !== 'string' || node.resourceId.length === 0) {
    errors.push(
      `view node at depth ${depth}: resourceId must be a non-empty string (observed: ${preview(node.resourceId)})`,
    );
  }
  if (typeof node.className !== 'string' || node.className.length === 0) {
    errors.push(
      `view node at depth ${depth}: className must be a non-empty string (observed: ${preview(node.className)})`,
    );
  }
  if (typeof node.text !== 'string') {
    errors.push(
      `view node at depth ${depth}: text must be a string, possibly empty (observed: ${preview(node.text)})`,
    );
  }
  if (typeof node.contentDescription !== 'string') {
    errors.push(
      `view node at depth ${depth}: contentDescription must be a string, possibly empty (observed: ${preview(node.contentDescription)})`,
    );
  }
  if (!Array.isArray(node.children)) {
    errors.push(
      `view node at depth ${depth}: children must be an array (observed: ${preview(node.children)})`,
    );
    return;
  }
  for (const child of node.children) {
    validateViewTree(child, maxHierarchyDepth, depth + 1, errors);
  }
}

/** The node count, measured by traversal (every node, every depth). */
function countViewNodes(node: LinuxViewNode): number {
  return 1 + node.children.reduce((total, child) => total + countViewNodes(child), 0);
}

/** The max observed depth, measured by traversal (the root is depth 1). */
function measureViewDepth(node: LinuxViewNode): number {
  if (node.children.length === 0) {
    return 1;
  }
  return 1 + Math.max(...node.children.map((child) => measureViewDepth(child)));
}

// ---- the observation adapter --------------------------------------------------------

/**
 * Observe one screen through the host seam — fail-closed, measured.
 *
 * The host must be an object with a callable captureScreen; the env
 * must pass validateLinuxEnvironment (its errors are carried); an env
 * whose accessibilityBus is 'none' REFUSES observation honestly — a
 * NAMED error, nothing observed, the host never called (THE AT-SPI
 * LAW: no bus, no capture). The captured tree is validated node-by-node
 * and against the environment's depth budget (THE BUDGET LAW — an
 * over-depth tree refuses, nothing is observed). On success the
 * observation is MEASURED: screenDigest =
 * sha256Hex(canonicalJson(tree)), nodeCount and observedDepth counted.
 * Results, never exceptions — a THROWING host propagates loudly (never
 * swallowed, never a synthetic result).
 */
export async function observeLinuxScreen(
  host: unknown,
  env: unknown,
): Promise<LinuxObservationResult> {
  const errors: string[] = [];

  if (!isObservationHost(host)) {
    errors.push(
      `observation host must be an object with a callable captureScreen() method (observed: ${preview(host)})`,
    );
  }

  const environmentValidation = validateLinuxEnvironment(env);
  if (!environmentValidation.ok) {
    errors.push(...environmentValidation.errors);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const environment = env as LinuxEnvironment;
  const observationHost = host as LinuxObservationHost;

  // THE AT-SPI LAW (the honest refusal): v0.1 observes through AT-SPI
  // or not at all. An accessibilityBus of 'none' is a VALID descriptor
  // (the honest no-bus machine) — the observation refuses with a NAMED
  // error, nothing is observed, and the host is NEVER CALLED (no bus,
  // no capture — a capture without a bus would be fabricated evidence).
  if (environment.accessibilityBus === 'none') {
    return {
      ok: false,
      errors: [
        `accessibilityBus 'none' refuses observation honestly — no desktop accessibility bus, no capture (the AT-SPI law; the host was never called)`,
      ],
    };
  }

  // The capture — a THROWING host propagates loudly (never swallowed:
  // the caller's failure is the caller's; no synthetic result is ever
  // invented — the replay-benchmark precedent).
  const tree: unknown = await observationHost.captureScreen();

  // The tree validation — every node, every level, the budget law.
  const treeErrors: string[] = [];
  validateViewTree(tree, environment.maxHierarchyDepth, 1, treeErrors);
  if (treeErrors.length > 0) {
    return { ok: false, errors: treeErrors };
  }

  // The measurement — MEASURED, never asserted: the digest over the
  // canonical serialization (the same core hash + observe serializer),
  // the counts by traversal of the captured tree AS CAPTURED.
  const viewTree = tree as LinuxViewNode;
  const observation: LinuxObservation = {
    environmentVersion: environment.environmentVersion,
    screenDigest: await sha256Hex(canonicalJson(viewTree)),
    nodeCount: countViewNodes(viewTree),
    observedDepth: measureViewDepth(viewTree),
  };
  return { ok: true, observation };
}
