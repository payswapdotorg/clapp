# @clapp/sandbox — CLAPP execution contract (CLAPP-003, v0)

Untrusted-by-default execution for CLAPP: every program the platform observes,
synthesizes, or verifies runs through this package — never bare on the host.
Generated code is UNTRUSTED code; the executor is a security boundary.

## Public API

Exported from `src/index.ts` (the only public entry point):

| Export | Kind |
| --- | --- |
| `NetworkPolicyMode`, `NetworkPolicy`, `ExecutionProfile`, `ExecutionSpec`, `ExecutionOutcome`, `ExecutionResult`, `SandboxExecutor` | types |
| `ProcessSandboxExecutor` | class (v0 executor) |
| `defaultDenyAllNetwork()` | factory for the default posture |

Core contract types (`RunId`, `RunBudget`, …) come from `@clapp/core`.

## Executor: `Bun.spawn` (v0) — and why

v0 spawns child processes with **`Bun.spawn`**, not `node:child_process`:

- the repo toolchain is bun end-to-end (workspaces, test runner), so the
  native API is the lowest-compat-risk option under the runtime that actually
  executes it;
- it exposes first-class `kill()`, an `exited` promise, and web streams that
  map cleanly onto byte-capped capture;
- no shell is involved: `command` + `args` are passed as an argv array
  directly, so there is no command-injection surface by construction.

`SandboxExecutor` is the seam for a node-runtime port: a future
`NodeProcessSandboxExecutor` can wrap `node:child_process` behind the same
interface without touching consumers.

## Execution model

`prepare(profile, rootDir?)`:
- validates the budget (`maxDurationMs` positive & finite — **no budget, no
  execution**), the network policy, and the env allowlist;
- creates `rootDir` (explicit, or `<os.tmpdir()>/clapp-sandboxes/sandbox_<uuid>`
  by default, realpath-resolved);
- issues the profile id `sandbox_<uuid>`.

`execute(spec, runId?)`:
- **cwd isolation** — child cwd = `profile.rootDir` joined with `spec.cwd`
  (default `'.'`). A `spec.cwd` that resolves outside the root (including
  absolute paths or `../` traversal) is *rejected* before spawn. v0 checks
  lexical containment; see limitations below.
- **env filtering** — the child env contains ONLY `profile.envAllowlist`
  entries present in the parent env, plus the documented injections below.
- **duration budget** — REQUIRED. On overrun the child is killed
  (SIGTERM → 300 ms grace → SIGKILL) and the outcome is
  `{ status: 'budget-exceeded', reason: 'duration' }`.
- **output budget** — stdout and stderr are EACH capped at
  `budget.maxBytes ?? 1_048_576` bytes. Crossing a cap kills the child and
  the outcome is `{ status: 'budget-exceeded', reason: 'output-size' }` with
  `truncated: true`. Output exactly at the cap is not a violation.
- **exit-code capture** — natural exit codes propagate as
  `{ status: 'completed', exitCode }`. If the child died from a signal
  without a budget overrun, the POSIX shell convention is used:
  `128 + signum` (unknown signal → 143, i.e. 128+SIGTERM; no code and no
  signal → -1).
- **spawn failures** — an unresolvable command returns
  `{ status: 'spawn-error', error }` with all enforcement flags `false`
  (no child ever ran).

## Environment model (exact injection list)

The child env is built as:

1. every `profile.envAllowlist` key that exists in the parent env, with the
   parent's value;
2. **`PATH`** — injected (parent value, else `/usr/local/bin:/usr/bin:/bin`)
   because the spec command and runtime helpers are resolved through it;
3. **`HOME`** — injected only when present in the parent env; many runtimes
   need it for config/cache resolution. Never fabricated.

That is the complete list. Both injections are non-secret and intentional;
`enforcement.envFiltered` still reports `true` because the allowlist filter
was applied — the injections are part of this documented contract, not
leakage. Anything else in the parent env (secrets included) is dropped.

## Network policy — honest status

- `'deny-all'` is the **default posture in the type system**
  (`defaultDenyAllNetwork()`; `ExecutionProfile.network` is required, and a
  compile-time test asserts it).
- v0's child-process executor **cannot police a child's egress**, so
  `ExecutionResult.enforcement.networkEnforced` is **always `false`** in v0.
  This is a documented, deliberate honesty flag — not theater.
- The enforcement hook: the runner-integration wave (CLAPP-040 / browser
  runner, plus the paired differential runner) where every sandboxed run is
  fronted by a per-profile egress proxy / network namespace that materializes
  the `NetworkPolicy`. Consumers MUST check `networkEnforced` before assuming
  isolation; until it is `true`, treat any child as network-capable.

## Budgets: enforced vs declared (v0)

| Budget field | v0 status |
| --- | --- |
| `maxDurationMs` | **ENFORCED** — timeout kill (SIGTERM → SIGKILL) |
| `maxBytes` | **ENFORCED** — per-stream cap, truncation, kill on overrun |
| `maxMemoryMb` | declared only — no cgroup/rlimit wiring in v0 (follow-up) |
| `maxArtifacts` | declared only — enforced by the store wave (CLAPP-002) |

## Fixtures

| Fixture | Purpose |
| --- | --- |
| `fixtures/hello-app/main.ts` | prints `{ pid, cwd, hasSecretEnv }`, exits 0 — proves cwd isolation + env filtering from inside the child |
| `fixtures/sleep-app/main.ts` | prints pid, sleeps 60 s — proves the duration-budget kill |
| `fixtures/fail-app/main.ts` | exits 7 — proves exit-code propagation |
| `fixtures/spill-app/main.ts` | emits 2 KiB — proves output-size budget + truncation |
| `fixtures/stdin-echo-app/main.ts` | uppercases stdin back — proves `stdinData` passthrough |
| `fixtures/term-proof-app/main.ts` | traps SIGTERM, sleeps — proves the SIGKILL escalation leg of the kill ladder |

## Known limitations (v0)

- **Network enforcement deferred** — see above; `networkEnforced: false`.
- **No memory limits** — `maxMemoryMb` is not enforced (no cgroups/rlimits in
  the child-process executor yet).
- **Single-process kill** — the timeout kill signals the direct child only;
  grandchildren survive (fixtures are single-process; setsid + process-group
  kill is the follow-up).
- **Lexical cwd containment** — containment is checked on the resolved path,
  not through symlink resolution; a symlink inside the profile pointing
  outside is a v0 escape hatch to close (resolve/realpath or Landlock).
- **Per-stream output cap** — `maxBytes` applies to stdout and stderr
  independently, not to their sum.
- **UTF-8 boundary** — truncation cuts a byte count; a multi-byte character
  split at the cap decodes to replacement characters.
- **No stdin budget** — `stdinData` is written fully; an untrusted child that
  never reads cannot deadlock us (the write is failure-tolerant), but stdin
  size is not budgeted.
- **Bun runtime only** — the executor uses `Bun.spawn`; the
  `SandboxExecutor` interface is the port seam for node.
