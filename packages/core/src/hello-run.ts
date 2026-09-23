import type { RunEvent, RunMeta } from './contract';
import { newRunId } from './ids';

/** Shape returned by {@link buildHelloRun}. */
export interface HelloRun {
  run: RunMeta;
  events: RunEvent[];
}

/**
 * Reference "hello run" for Phase 0: a complete `RunMeta` plus the minimal
 * contract-conformant event stream (`run.started`, `log`, `run.completed`)
 * with 0-based strictly increasing `seq` and ordered ISO-8601 UTC timestamps.
 *
 * This seeds the "hello-run stored and replayed" exit criterion once
 * `packages/store` lands. The environment record captures only what is
 * directly observed about the current runtime — no invented values.
 */
export function buildHelloRun(): HelloRun {
  const id = newRunId();
  const startedAtMs = Date.now();

  const startedAt = new Date(startedAtMs).toISOString();
  const loggedAt = new Date(startedAtMs + 1).toISOString();
  const endedAt = new Date(startedAtMs + 2).toISOString();

  const targetId = 'bench/b00-hello';

  const run: RunMeta = {
    id,
    targetId,
    kind: 'hello',
    status: 'completed',
    startedAt,
    endedAt,
    environment: currentEnvironment(),
    budget: {
      maxDurationMs: 60_000,
      maxMemoryMb: 128,
      maxArtifacts: 16,
      maxBytes: 8_388_608,
    },
  };

  const events: RunEvent[] = [
    {
      runId: id,
      seq: 0,
      ts: startedAt,
      kind: 'run.started',
      payload: { targetId, kind: 'hello' },
    },
    {
      runId: id,
      seq: 1,
      ts: loggedAt,
      kind: 'log',
      payload: { level: 'info', message: 'hello from @clapp/core' },
    },
    {
      runId: id,
      seq: 2,
      ts: endedAt,
      kind: 'run.completed',
      payload: { status: 'completed' },
    },
  ];

  return { run, events };
}

/** Observed execution environment — direct runtime introspection only. */
function currentEnvironment(): Record<string, unknown> {
  const runtime = typeof Bun !== 'undefined' ? 'bun' : 'node';
  const runtimeVersion = typeof Bun !== 'undefined' ? Bun.version : process.version;
  return { runtime, runtimeVersion };
}
