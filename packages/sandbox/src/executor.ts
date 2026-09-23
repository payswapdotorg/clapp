/**
 * @clapp/sandbox — ProcessSandboxExecutor (CLAPP-003, v0).
 *
 * Executes UNTRUSTED programs (observed targets, synthesized candidates,
 * verification jobs) as child processes inside an isolated execution profile:
 *
 * - cwd isolation: the child working directory is pinned inside
 *   `profile.rootDir`; a `spec.cwd` that escapes the root (absolute paths or
 *   `../` traversal) is rejected before spawn.
 * - env filtering: ONLY `profile.envAllowlist` keys pass through, plus the
 *   documented minimal injections (see INJECTED_ENV_KEYS / README).
 * - duration budget: REQUIRED. On overrun the child is killed
 *   (SIGTERM → KILL_GRACE_MS → SIGKILL) and reported as
 *   budget-exceeded/duration.
 * - output budget: stdout and stderr are each capped at `budget.maxBytes`
 *   (default 1 MiB). Crossing a cap kills the child and reports
 *   budget-exceeded/output-size with truncated=true.
 * - exit-code capture: natural exit codes propagate; death-by-signal maps to
 *   128 + signum (POSIX shell convention) when no budget was overrun.
 *
 * Executor choice: `Bun.spawn` (documented, not node:child_process) because
 * the repo toolchain is bun end-to-end (workspaces, test runner), making the
 * native spawn API the lowest-compat-risk option with first-class kill /
 * exited / stream semantics. `SandboxExecutor` is the seam for a node-runtime
 * port.
 *
 * No shell is involved: command and args are passed as an argv array, so
 * there is no command-injection surface by construction.
 *
 * Network policy: `networkEnforced` is ALWAYS false in v0 — a plain child
 * process cannot police its own egress. The declared policy (default
 * deny-all) is carried in the profile and materialized at the runner layer
 * in the runner-integration wave (CLAPP-040). See types.ts and README.
 */

import { mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RunBudget, RunId } from '@clapp/core';
import type {
  ExecutionOutcome,
  ExecutionProfile,
  ExecutionResult,
  ExecutionSpec,
  NetworkPolicy,
  NetworkPolicyMode,
  SandboxExecutor,
} from './types';

/** Root folder (under the OS tmpdir) for default execution profiles. */
const DEFAULT_PROFILE_BASE = 'clapp-sandboxes';

/**
 * Grace period between SIGTERM and SIGKILL when a budget forces us to kill
 * the child. Short by design: untrusted code gets no meaningful grace.
 */
const KILL_GRACE_MS = 300;

/** Default per-stream output cap when budget.maxBytes is unset (1 MiB). */
const DEFAULT_MAX_BYTES = 1_048_576;

/**
 * Environment keys injected into every child IN ADDITION to the profile
 * allowlist:
 * - `PATH` — required to resolve the spec command and runtime helpers;
 *   falls back to a static POSIX default when the parent env has none.
 * - `HOME` — required by many runtimes for config/cache resolution; only
 *   injected when present in the parent env, never fabricated.
 *
 * Both are non-secret and intentional; this is the COMPLETE injection list
 * (see README "Environment model"). Everything else in the parent env —
 * secrets included — is dropped.
 */
const INJECTED_ENV_KEYS: readonly string[] = ['PATH', 'HOME'];

/** POSIX fallback when the parent environment has no PATH. */
const DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin';

/** Common POSIX signal names → numbers, used for the 128+signum exit-code mapping. */
const SIGNAL_NUMBERS: Readonly<Record<string, number>> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
};

const NETWORK_POLICY_MODES: readonly NetworkPolicyMode[] = [
  'deny-all',
  'allowlist',
  'allow-all',
];

const utf8Decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Runtime input validation — the sandbox is a security boundary, so every
// input is validated at runtime, not just at the type level.
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) {
    return 'NaN';
  }
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

/**
 * No budget, no execution. `maxDurationMs` must be a positive finite number;
 * optional ceilings must be finite numbers >= 0 when present.
 */
function requireValidBudget(budget: RunBudget | undefined | null): void {
  if (budget === undefined || budget === null) {
    throw new Error('ExecutionRefused: profile.budget is required — no budget, no execution.');
  }
  if (!isFiniteNumber(budget.maxDurationMs) || budget.maxDurationMs <= 0) {
    throw new Error(
      `ExecutionRefused: budget.maxDurationMs must be a positive finite number (got ${describeValue(budget.maxDurationMs)}).`,
    );
  }
  const optionalCeilings: Array<readonly [string, number | undefined]> = [
    ['maxBytes', budget.maxBytes],
    ['maxMemoryMb', budget.maxMemoryMb],
    ['maxArtifacts', budget.maxArtifacts],
  ];
  for (const [field, value] of optionalCeilings) {
    if (value !== undefined && (!isFiniteNumber(value) || value < 0)) {
      throw new Error(
        `ExecutionRefused: budget.${field} must be a finite number >= 0 (got ${describeValue(value)}).`,
      );
    }
  }
}

function requireValidNetworkPolicy(network: NetworkPolicy): void {
  if (!NETWORK_POLICY_MODES.includes(network.mode)) {
    throw new Error(
      `ExecutionRefused: network.mode must be one of deny-all|allowlist|allow-all (got ${describeValue(network.mode)}).`,
    );
  }
  if (
    network.mode === 'allowlist' &&
    (!Array.isArray(network.allowHosts) || network.allowHosts.length === 0)
  ) {
    throw new Error(
      "ExecutionRefused: network.mode 'allowlist' requires a non-empty allowHosts list.",
    );
  }
}

function requireValidEnvAllowlist(envAllowlist: string[]): void {
  if (!Array.isArray(envAllowlist) || envAllowlist.some((key) => typeof key !== 'string')) {
    throw new Error(
      'ExecutionRefused: profile.envAllowlist must be an array of environment variable names.',
    );
  }
}

// ---------------------------------------------------------------------------
// Environment model
// ---------------------------------------------------------------------------

function buildChildEnv(parentEnv: NodeJS.ProcessEnv, allowlist: string[]): Record<string, string> {
  const childEnv: Record<string, string> = {};
  for (const key of allowlist) {
    const value = parentEnv[key];
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }
  for (const key of INJECTED_ENV_KEYS) {
    if (childEnv[key] === undefined) {
      const value = parentEnv[key];
      if (value !== undefined) {
        childEnv[key] = value;
      }
    }
  }
  if (childEnv['PATH'] === undefined) {
    // Parent env had no PATH: fall back to a static POSIX default so the
    // runtime can still be resolved and spawned.
    childEnv['PATH'] = DEFAULT_PATH;
  }
  return childEnv;
}

// ---------------------------------------------------------------------------
// cwd isolation
// ---------------------------------------------------------------------------

/**
 * Resolves the child cwd and rejects any spec.cwd that escapes the profile
 * rootDir (including absolute paths and `../` traversal). Containment is
 * lexical in v0 — see README limitations.
 */
function resolveIsolatedCwd(rootDir: string, relativeCwd: string | undefined): string {
  const base = resolve(rootDir);
  const cwd = resolve(base, relativeCwd ?? '.');
  const contained = cwd === base || cwd.startsWith(base + sep);
  if (!contained) {
    throw new Error(
      `ExecutionRefused: spec.cwd (${describeValue(relativeCwd ?? '.')}) resolves outside the execution profile rootDir (${base}).`,
    );
  }
  return cwd;
}

// ---------------------------------------------------------------------------
// Output capture with per-stream byte caps
// ---------------------------------------------------------------------------

interface CapturedStream {
  text: string;
  truncated: boolean;
}

/**
 * Reads a piped child stream, keeping at most `capBytes` bytes. Crossing the
 * cap (strictly more than capBytes produced) calls `onExceeded` — which the
 * executor uses to kill the child — and stops reading; the reader is then
 * cancelled so the unread pipe cannot hold the run open.
 *
 * Note: truncation cuts a byte count; a multi-byte UTF-8 character split at
 * the cap decodes to replacement characters.
 */
async function captureCapped(
  stream: ReadableStream<Uint8Array> | null | undefined,
  capBytes: number,
  onExceeded: () => void,
): Promise<CapturedStream> {
  if (stream === null || stream === undefined) {
    return { text: '', truncated: false };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let captured = 0;
  let truncated = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done === true) {
        break;
      }
      const value = chunk.value;
      if (value === undefined) {
        continue;
      }
      if (captured + value.length > capBytes) {
        const remaining = capBytes - captured;
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining));
        }
        captured = capBytes;
        truncated = true;
        onExceeded();
        break;
      }
      chunks.push(value);
      captured += value.length;
    }
  } catch {
    // Rare: a failed pipe read. Keep what was captured and treat it as
    // end-of-stream rather than crashing the executor.
  } finally {
    if (truncated) {
      void reader.cancel().catch(() => {
        // Stream already closed — nothing to cancel.
      });
    } else {
      reader.releaseLock();
    }
  }
  const merged = new Uint8Array(captured);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: utf8Decoder.decode(merged), truncated };
}

// ---------------------------------------------------------------------------
// Exit-code mapping
// ---------------------------------------------------------------------------

/**
 * Natural exit codes win. Death-by-signal (without a budget overrun) maps to
 * 128 + signum, the POSIX shell convention; unknown signal names fall back to
 * 128+15 (SIGTERM); a process that left the stage with neither code nor
 * signal reports -1.
 */
function exitCodeOf(exitCode: number | null, signalCode: string | null | undefined): number {
  if (exitCode !== null) {
    return exitCode;
  }
  if (signalCode !== null && signalCode !== undefined) {
    const signum = SIGNAL_NUMBERS[signalCode] ?? 15;
    return 128 + signum;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

/**
 * Spawns the child, or captures the synchronous spawn failure (e.g. the
 * command cannot be resolved). The return type is deliberately inferred so
 * the exact Bun.spawn subprocess typing flows through without hand-written
 * generics.
 */
function trySpawn(spec: ExecutionSpec, cwd: string, env: Record<string, string>) {
  try {
    return {
      proc: Bun.spawn({
        cmd: [spec.command, ...spec.args],
        cwd,
        env,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    };
  } catch (error) {
    return { error };
  }
}

function buildSpawnErrorResult(
  spec: ExecutionSpec,
  runId: RunId | undefined,
  error: unknown,
  startedAt: Date,
): ExecutionResult {
  const endedAt = new Date();
  return {
    runId: runId ?? null,
    profileId: spec.profile.id,
    outcome: {
      status: 'spawn-error',
      error: error instanceof Error ? error.message : String(error),
    },
    stdout: '',
    stderr: '',
    durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
    truncated: false,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    enforcement: {
      // No child process ever ran, so nothing was enforced against one.
      // The flags describe the executed child; a spawn-error means there
      // was no child.
      cwdIsolated: false,
      envFiltered: false,
      networkEnforced: false,
      durationBudget: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class ProcessSandboxExecutor implements SandboxExecutor {
  async prepare(
    profile: Omit<ExecutionProfile, 'id' | 'rootDir'>,
    rootDir?: string,
  ): Promise<ExecutionProfile> {
    requireValidBudget(profile.budget);
    requireValidNetworkPolicy(profile.network);
    requireValidEnvAllowlist(profile.envAllowlist);

    const id = `sandbox_${randomUUID()}`;
    const requestedRoot =
      rootDir !== undefined ? resolve(rootDir) : join(tmpdir(), DEFAULT_PROFILE_BASE, id);
    mkdirSync(requestedRoot, { recursive: true });
    let realRoot: string;
    try {
      // realpath so that the child's process.cwd() and profile.rootDir are
      // byte-identical even on symlinked tmpdirs.
      realRoot = realpathSync(requestedRoot);
    } catch {
      // Extremely unlikely right after mkdir; keep the lexical path if so.
      realRoot = requestedRoot;
    }
    return { ...profile, id, rootDir: realRoot };
  }

  async execute(spec: ExecutionSpec, runId?: RunId): Promise<ExecutionResult> {
    // Security boundary: validate every runtime input, even for profiles that
    // bypassed prepare() (hand-assembled by untrusted callers).
    requireValidBudget(spec.profile.budget);
    requireValidNetworkPolicy(spec.profile.network);
    requireValidEnvAllowlist(spec.profile.envAllowlist);

    // requireValidBudget threw otherwise — no budget, no execution.
    const budget: RunBudget = spec.profile.budget;
    const rootDir = resolve(spec.profile.rootDir);
    const cwd = resolveIsolatedCwd(rootDir, spec.cwd);
    const maxBytes = budget.maxBytes ?? DEFAULT_MAX_BYTES;
    const childEnv = buildChildEnv(process.env, spec.profile.envAllowlist);

    const startedAt = new Date();
    const startMs = startedAt.getTime();

    const spawnAttempt = trySpawn(spec, cwd, childEnv);
    if ('error' in spawnAttempt) {
      return buildSpawnErrorResult(spec, runId, spawnAttempt.error, startedAt);
    }
    const proc = spawnAttempt.proc;

    // stdin: write the payload (if any) and close — the child sees EOF.
    try {
      if (spec.stdinData !== undefined) {
        proc.stdin.write(spec.stdinData);
      }
      void proc.stdin.end();
    } catch {
      // The child may already have exited; a failed stdin write is non-fatal.
    }

    // --- Budget enforcement state ------------------------------------------
    let overrun: 'duration' | 'output-size' | null = null;
    let escalationTimer: ReturnType<typeof setTimeout> | undefined;
    let killInitiated = false;

    const killChild = (): void => {
      if (killInitiated) {
        return;
      }
      killInitiated = true;
      try {
        proc.kill(15); // SIGTERM
      } catch {
        // Already exited — nothing to signal.
      }
      escalationTimer = setTimeout(() => {
        try {
          proc.kill(9); // SIGKILL — escalate after the grace period
        } catch {
          // Already exited — nothing to signal.
        }
      }, KILL_GRACE_MS);
    };

    const markOverrun = (reason: 'duration' | 'output-size'): void => {
      if (overrun === null) {
        overrun = reason;
      }
      killChild();
    };

    const durationTimer = setTimeout(() => {
      // If the child already left the stage, the budget was met in fact —
      // never report a duration overrun for work that finished in time (the
      // exited-promise resolution can lag the true exit by a tick).
      if (proc.exitCode !== null || proc.signalCode !== null) {
        return;
      }
      markOverrun('duration');
    }, budget.maxDurationMs);

    // --- Output capture with per-stream caps --------------------------------
    const stdoutCapture = captureCapped(proc.stdout, maxBytes, () => markOverrun('output-size'));
    const stderrCapture = captureCapped(proc.stderr, maxBytes, () => markOverrun('output-size'));

    // --- Wait for the child to leave the stage ------------------------------
    let endMs: number;
    try {
      await proc.exited.catch(() => {
        // exited rejecting is not expected; treat as an unknown exit.
      });
      endMs = Date.now();
    } finally {
      clearTimeout(durationTimer);
      if (escalationTimer !== undefined) {
        clearTimeout(escalationTimer);
      }
    }

    const [stdout, stderr] = await Promise.all([stdoutCapture, stderrCapture]);
    if (escalationTimer !== undefined) {
      // A kill may have been initiated during late stream reads (post-exit
      // output overrun); don't leave the SIGKILL escalation armed.
      clearTimeout(escalationTimer);
    }
    const endedAt = new Date(endMs);

    const truncated = stdout.truncated || stderr.truncated;
    const outcome: ExecutionOutcome =
      overrun !== null
        ? { status: 'budget-exceeded', reason: overrun }
        : { status: 'completed', exitCode: exitCodeOf(proc.exitCode, proc.signalCode) };

    return {
      runId: runId ?? null,
      profileId: spec.profile.id,
      outcome,
      stdout: stdout.text,
      stderr: stderr.text,
      durationMs: Math.max(0, endMs - startMs),
      truncated,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      enforcement: {
        cwdIsolated: true, // resolved + containment-checked before spawn
        envFiltered: true, // strict allowlist + documented injections applied
        networkEnforced: false, // v0: egress control lands with the runner wave — see types.ts / README
        durationBudget: true, // timeout kill was armed for this execution
      },
    };
  }
}
