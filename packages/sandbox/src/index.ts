/**
 * @clapp/sandbox — CLAPP execution contract (CLAPP-003).
 *
 * Untrusted-by-default: every generated/observed program executes inside an
 * ExecutionProfile with an explicit, enforced budget. Nothing runs bare on
 * the host, and nothing runs without a budget.
 *
 * This module is the package's ONLY public entry point (see package.json
 * exports). Everything else under src/ is internal.
 *
 * Quick start:
 *
 *   const executor = new ProcessSandboxExecutor();
 *   const profile = await executor.prepare({
 *     envAllowlist: [],
 *     network: defaultDenyAllNetwork(),
 *     budget: { maxDurationMs: 10_000 },
 *     label: 'candidate-run',
 *   });
 *   const result = await executor.execute(
 *     { profile, command: 'bun', args: ['fixtures/hello-app/main.ts'] },
 *   );
 *
 * See README.md for the execution model, the environment model, the honest
 * network-enforcement status, and v0 limitations.
 */

export type {
  NetworkPolicyMode,
  NetworkPolicy,
  ExecutionProfile,
  ExecutionSpec,
  ExecutionOutcome,
  ExecutionResult,
  SandboxExecutor,
} from './types';

export { ProcessSandboxExecutor } from './executor';

export { defaultDenyAllNetwork } from './policy';
