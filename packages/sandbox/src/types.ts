/**
 * @clapp/sandbox — public types for the CLAPP execution contract (CLAPP-003).
 *
 * These declarations mirror the tech-lead interface (CLAPP-003 §4.2) exactly:
 * names, field names, and shapes are frozen; doc comments are ours.
 */

import type { RunBudget, RunId } from '@clapp/core';

/** Coarse network posture for an execution profile. */
export type NetworkPolicyMode = 'deny-all' | 'allowlist' | 'allow-all';

export interface NetworkPolicy {
  mode: NetworkPolicyMode;              // DEFAULT POSTURE: 'deny-all'
  allowHosts?: string[];                // hostnames/CIDRs when mode='allowlist'
}

export interface ExecutionProfile {
  id: string;                           // "sandbox_" + uuid
  rootDir: string;                      // isolated working directory for the run
  envAllowlist: string[];               // ONLY these env vars pass through
  network: NetworkPolicy;
  budget: RunBudget;                    // REQUIRED — no execution without a budget
  label?: string;                       // human-readable, e.g. "candidate-run"
}

export interface ExecutionSpec {
  profile: ExecutionProfile;
  command: string;                      // e.g. "bun"
  args: string[];                       // e.g. ["fixtures/hello-app/main.ts"]
  cwd?: string;                         // relative to profile.rootDir, default '.'
  stdinData?: string;
}

export type ExecutionOutcome =
  | { status: 'completed'; exitCode: number }
  | { status: 'budget-exceeded'; reason: 'duration' | 'output-size' }
  | { status: 'spawn-error'; error: string };

export interface ExecutionResult {
  runId: RunId | null;                  // null = executed outside a tracked run
  profileId: string;
  outcome: ExecutionOutcome;
  stdout: string;                       // truncated to budget.maxBytes (default 1 MiB)
  stderr: string;                       // same truncation
  durationMs: number;                   // wall clock
  truncated: boolean;                   // true if output was cut
  startedAt: string;                    // ISO-8601 UTC
  endedAt: string;                      // ISO-8601 UTC
  enforcement: {                        // HONEST reporting of what was enforced
    cwdIsolated: boolean;               // child cwd inside profile.rootDir
                                        // (v0: lexical containment — a symlink
                                        // inside the profile pointing outward
                                        // is a documented limitation; see
                                        // README "Known limitations")
    envFiltered: boolean;               // allowlist applied
    networkEnforced: boolean;           // ALWAYS false in the v0 child-process
                                        // executor: a plain child process cannot
                                        // police its own egress. Real egress
                                        // control lands with the browser/runner
                                        // integration (CLAPP-040) at the runner
                                        // egress-proxy / netns layer — the hook
                                        // is SandboxExecutor implementations
                                        // that own the child's network stack.
                                        // Consumers MUST check this flag before
                                        // assuming network isolation. Honesty
                                        // over theater: this reports reality.
    durationBudget: boolean;            // timeout kill armed
  };
}

export interface SandboxExecutor {
  prepare(profile: Omit<ExecutionProfile, 'id' | 'rootDir'>, rootDir?: string):
    Promise<ExecutionProfile>;          // creates rootDir + id; validates budget
  execute(spec: ExecutionSpec, runId?: RunId): Promise<ExecutionResult>;
}
