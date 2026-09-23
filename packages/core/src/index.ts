/**
 * @clapp/core — public API.
 *
 * The run/event/artifact contract v0 plus small pure helpers. Everything the
 * platform types against is exported from this file only; sibling packages
 * must import `@clapp/core` and never reach into deeper paths.
 *
 * Contract changes require a tech-lead interface-freeze decision
 * (see docs/WORKLOG.md).
 */

export type * from './contract';

export {
  ARTIFACT_KINDS,
  EVIDENCE_KINDS,
  RUN_STATUSES,
  assertMonotonicSeq,
  validateRunEvent,
} from './events';

export { newArtifactId, newEvidenceId, newRunId } from './ids';

export { sha256Hex } from './hash';

export { buildHelloRun } from './hello-run';
export type { HelloRun } from './hello-run';
