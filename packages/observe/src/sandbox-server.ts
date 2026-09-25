/**
 * @clapp/observe — sandbox fixture-server launcher.
 *
 * `launchServerInSandbox` starts a fixture HTTP server INSIDE an isolated
 * ExecutionProfile through the frozen SandboxExecutor contract:
 *
 *  1. prepare() creates the profile (isolated rootDir, env allowlist,
 *     network posture, REQUIRED budget);
 *  2. fixture files (path → content) are written into the rootDir with
 *     lexical containment enforcement (a fixture path that tries to
 *     escape the profile is rejected before anything is written);
 *  3. executor.execute() spawns the server (never awaited here — the
 *     returned handle exposes the pending result);
 *  4. ready-poll: wait for the server's port file, then poll the HTTP
 *     endpoint until it answers (any status = ready);
 *  5. budget-reaper: the executor's duration budget SIGTERMs→SIGKILLs the
 *     server at budget exhaustion even if the caller disappears — that is
 *     the hard reaper. The cooperative reaper is the optional `stopPath`:
 *     a fixture route that makes the server exit, so close() is graceful
 *     and fast. Without a stopPath, close() waits for the budget kill.
 *
 * Port assignment: the fixture binds port 0 (ephemeral, race-free) and
 * writes the actual port to `portFile` (default 'server.port') in the
 * profile rootDir; this module reads it. No env vars are needed by the
 * child (the executor only passes the allowlist — see sandbox README).
 *
 * Honest limitations (v0):
 *  - we cannot externally kill the sandboxed server mid-budget (no PID
 *    handle through the frozen executor contract): budget is the hard
 *    kill, stopPath is the cooperative one;
 *  - networkEnforced is false in the v0 child-process executor — the
 *    profile's deny-all posture is declarative here (the fixture only
 *    needs loopback); real egress control lands at CLAPP-040;
 *  - a ready timeout REJECTS the launch but leaves the server running
 *    until its budget reaps it (surfaced via error.result so callers can
 *    await it).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { RunBudget, RunId } from '@clapp/core';
import { defaultDenyAllNetwork } from '@clapp/sandbox';
import type { ExecutionProfile, ExecutionResult, NetworkPolicy, SandboxExecutor } from '@clapp/sandbox';

export interface LaunchServerInSandboxOptions {
  /** server command, e.g. 'bun' */
  command: string;
  /** server argv, e.g. ['server.ts'] (relative to the profile rootDir) */
  args: string[];
  /** working directory inside the profile (default '.') */
  cwd?: string;
  /** fixture files to write into the profile rootDir: relative path → UTF-8 content */
  fixtures: Record<string, string>;
  /** REQUIRED — the budget that reaps the server (no budget, no execution). */
  budget: RunBudget;
  /** extra env vars to pass through (PATH/HOME are injected by the executor) */
  envAllowlist?: string[];
  /** network posture (default deny-all, declarative in v0) */
  network?: NetworkPolicy;
  /** caller-supplied profile rootDir (default: executor-managed temp dir) */
  rootDir?: string;
  /** file the fixture writes its bound port to (default 'server.port') */
  portFile?: string;
  /** host to poll (default '127.0.0.1') */
  host?: string;
  /** path polled for HTTP readiness (default '/') */
  readyPath?: string;
  /** total ready deadline in ms (default: min(budget − 500ms, 15s)) */
  readyTimeoutMs?: number;
  /** poll interval in ms (default 50) */
  pollIntervalMs?: number;
  /** cooperative-stop route: POST it to make the server exit (enables graceful close) */
  stopPath?: string;
  /** run id the execution is attributed to (optional) */
  runId?: RunId;
  /** profile label (default 'clapp-fixture-server') */
  label?: string;
}

export interface LaunchedServer {
  profile: ExecutionProfile;
  port: number;
  baseUrl: string;
  /** resolves when the server process exits (budget-reaped, stopped, or crashed) */
  result: Promise<ExecutionResult>;
  /** true once the result has settled as budget-exceeded */
  readonly exhausted: boolean;
  /** graceful stop (stopPath) or wait-for-budget; idempotent */
  close(): Promise<ExecutionResult>;
}

/** Launch failure; `result` lets callers await the (budget-reaped) process. */
export class ServerLaunchError extends Error {
  constructor(message: string, readonly result: Promise<ExecutionResult>) {
    super(message);
    this.name = 'ServerLaunchError';
  }
}

const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_READY_TIMEOUT_MS = 15_000;

export async function launchServerInSandbox(
  executor: SandboxExecutor,
  opts: LaunchServerInSandboxOptions,
): Promise<LaunchedServer> {
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const readyTimeoutMs = opts.readyTimeoutMs ?? Math.max(250, Math.min(opts.budget.maxDurationMs - 500, DEFAULT_READY_TIMEOUT_MS));
  if (readyTimeoutMs >= opts.budget.maxDurationMs) {
    throw new Error(
      `launchServerInSandbox: readyTimeoutMs (${readyTimeoutMs}ms) must be smaller than budget.maxDurationMs (${opts.budget.maxDurationMs}ms) so the budget can reap an unresponsive server`,
    );
  }

  const profile = await executor.prepare(
    {
      envAllowlist: opts.envAllowlist ?? [],
      network: opts.network ?? defaultDenyAllNetwork(),
      budget: opts.budget,
      label: opts.label ?? 'clapp-fixture-server',
    },
    opts.rootDir,
  );

  writeFixtures(profile.rootDir, opts.fixtures);

  const resultPromise = executor.execute(
    { profile, command: opts.command, args: opts.args, cwd: opts.cwd },
    opts.runId,
  );
  // mark the result promise as handled so a caller that never awaits
  // close()/result cannot trigger an unhandled-rejection for internal errors
  resultPromise.catch(() => undefined);

  let settledResult: ExecutionResult | null = null;
  resultPromise.then(
    (result) => {
      settledResult = result;
    },
    () => undefined,
  );

  const host = opts.host ?? '127.0.0.1';
  const readyPath = opts.readyPath ?? '/';
  const portFilePath = join(profile.rootDir, opts.portFile ?? 'server.port');
  const deadline = Date.now() + readyTimeoutMs;

  const exited = (): string | null =>
    settledResult !== null ? describeOutcome(settledResult) : null;

  // --- phase 1: port file ---
  let port: number | null = null;
  while (Date.now() < deadline) {
    const exitInfo = exited();
    if (exitInfo !== null) {
      throw new ServerLaunchError(`fixture server exited before becoming ready (${exitInfo})`, resultPromise);
    }
    if (existsSync(portFilePath)) {
      try {
        const parsed = Number.parseInt(readFileSync(portFilePath, 'utf8').trim(), 10);
        if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
          port = parsed;
          break;
        }
      } catch {
        // unreadable port file yet (partial write) — keep polling
      }
    }
    await sleep(pollIntervalMs);
  }
  if (port === null) {
    throw new ServerLaunchError(
      `fixture server did not write ${opts.portFile ?? 'server.port'} within ${readyTimeoutMs}ms`,
      resultPromise,
    );
  }

  // --- phase 2: HTTP readiness (any response status counts) ---
  const baseUrl = `http://${host}:${port}`;
  for (;;) {
    const exitInfo = exited();
    if (exitInfo !== null) {
      throw new ServerLaunchError(`fixture server exited before becoming ready (${exitInfo})`, resultPromise);
    }
    if (Date.now() >= deadline) {
      throw new ServerLaunchError(`fixture server at ${baseUrl} did not answer ${readyPath} within ${readyTimeoutMs}ms`, resultPromise);
    }
    if (await probeHttp(`${baseUrl}${readyPath}`, Math.max(pollIntervalMs * 4, 200))) {
      break;
    }
    await sleep(pollIntervalMs);
  }

  let closed = false;
  const handle: LaunchedServer = {
    profile,
    port,
    baseUrl,
    result: resultPromise,
    get exhausted(): boolean {
      return settledResult !== null && settledResult.outcome.status === 'budget-exceeded';
    },
    close: async () => {
      if (closed) {
        return resultPromise;
      }
      closed = true;
      if (opts.stopPath !== undefined) {
        await fetch(`${baseUrl}${opts.stopPath}`, { method: 'POST', signal: AbortSignal.timeout(3000) }).catch(() => undefined);
      }
      const result = await resultPromise;
      settledResult = result;
      return result;
    },
  };
  return handle;
}

function writeFixtures(rootDir: string, fixtures: Record<string, string>): void {
  const root = resolve(rootDir);
  for (const relativePath of Object.keys(fixtures)) {
    const target = resolve(root, relativePath);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`launchServerInSandbox: fixture path escapes the execution profile: ${relativePath}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, fixtures[relativePath]!, 'utf8');
  }
}

async function probeHttp(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    // any HTTP answer (including 4xx/5xx) proves the server is listening
    await response.arrayBuffer().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

function describeOutcome(result: ExecutionResult): string {
  const outcome = result.outcome;
  switch (outcome.status) {
    case 'completed':
      return `exit code ${outcome.exitCode}`;
    case 'budget-exceeded':
      return `budget-exceeded (${outcome.reason})`;
    case 'spawn-error':
      return `spawn-error: ${outcome.error}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
