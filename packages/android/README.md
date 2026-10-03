# @clapp/android

CLAPP Android adapter (**CLAPP-080**, the P8 opener — Worker 1,
Observation and Platform Adapters, per `docs/WORKER_HANDOFFS.md`): the
five platform components `docs/WORK_ITEMS.md` P8 demands, delivered as
v0.1 **contracts** over the frozen core/observe contracts.

> **THE NO-FORK LAW (P8, verbatim from `docs/WORK_ITEMS.md`):**
> "Do not fork the core Behavioral IR."
>
> This package **consumes** the frozen contracts — `@clapp/core`
> (`sha256Hex`; `EVIDENCE_KINDS`, the core's own closed-vocabulary
> mirror) and `@clapp/observe` (`canonicalJson`) at RUNTIME, and
> `@clapp/diff` / `@clapp/ir` / `@clapp/journey` vocabularies through
> their own machinery, TYPE-ONLY — and produces **contract-shaped
> DATA**. It never redefines, rewrites, or forks any IR/contract type.
> `test/android.test.ts`'s import-discipline test pins this.

## The five components (the P8 law)

| # | Component | Module | Surface |
|---|-----------|--------|---------|
| 1 | environment descriptor | `src/environment.ts` | `AndroidEnvironment`, `ANDROID_ENVIRONMENT_VERSION`, `ANDROID_PERMISSIONS`, `validateAndroidEnvironment` |
| 2 | observation adapter | `src/observation.ts` | `AndroidViewNode`, `AndroidObservationHost`, `AndroidObservation`, `observeAndroidScreen` |
| 3 | evidence emitter | `src/evidence.ts` | `emitObservationEvidence` |
| 4 | synthesis target | `src/synthesis-target.ts` | `AndroidSynthesisTarget`, `ANDROID_TARGET_VERSION`, `ANDROID_DENSITIES`, `validateAndroidSynthesisTarget` |
| 5 | verification adapter | `src/verification.ts` | `AndroidVerificationHost`, `AndroidVerificationRun`, `verifyAndroidJourneys` |

`src/index.ts` re-exports the five components' contracts + validators
(the house style).

## The host-seam law (the honest boundary)

Everything environment-specific enters through exactly TWO duck-typed
seams:

- **`AndroidObservationHost`** — `captureScreen(): Promise<AndroidViewNode>`
- **`AndroidVerificationHost`** — `runJourney(journeyId): Promise<{ completed: boolean; failureReason?: string }>`

The seam contracts are the lane's deliverable; the **tests fake them**
(`test/fixtures/fake-hosts.ts`). Real `adb shell uiautomator` /
accessibility-tree / emulator / instrumentation bindings are
**deployment scope** — later lanes, never this package. A host is
admitted only by duck-typing (an object with the callable method), a
malformed capture/outcome is a named error, and a **throwing host
propagates loudly** (the caller's failure is the caller's — never
swallowed, never converted into a synthetic result; the
replay-benchmark precedent).

## Frozen vocabularies (v0.1)

- `ANDROID_ENVIRONMENT_VERSION` = `'0.1'`; `ANDROID_TARGET_VERSION` = `'0.1'`
- `platform` = `'android'` (the frozen platform literal on both descriptors)
- `ANDROID_PERMISSIONS` (the five modeled permissions):
  `android.permission.INTERNET`, `android.permission.CAMERA`,
  `android.permission.READ_EXTERNAL_STORAGE`,
  `android.permission.WRITE_EXTERNAL_STORAGE`,
  `android.permission.ACCESS_FINE_LOCATION`
- `ANDROID_DENSITIES` (the five resource buckets):
  `mdpi`, `hdpi`, `xhdpi`, `xxhdpi`, `xxxhdpi`

"Sorted" means lexicographic ascending (code-unit order — the default
`Array.prototype.sort()` on strings), the same law for every sorted
vocabulary in this package.

## The prefix discipline

Android observation evidence ids are minted **content-derived**:
`'andev_' + screenDigest.slice(0, 32) + '-' + kind` — deterministic,
no uuid, no clock, no randomness (the content-addressed-identity house
law; `andev_` is this lane's prefix). The emitted record IS the core's
`EvidenceRef` (`@clapp/core` — imported TYPE-ONLY), with `sha256`
carrying the observation's `screenDigest` verbatim: the capture's own
measured digest, never re-asserted. `kind` must be one of the frozen
`EVIDENCE_KINDS` (consumed from the core's runtime mirror — one source
of truth; an unknown kind is a named error).

## The determinism discipline

No clock, no randomness, no network, no filesystem, no global state.
The same captured tree canonicalizes identically
(`canonicalJson`, sorted keys) and hashes identically (`sha256Hex`,
WebCrypto) → the same `screenDigest` → the same `andev_` evidence id,
forever. Observation counts (`nodeCount`, `observedDepth`) and
verification counts (`completed`, `failed`) are **MEASURED** — counted
by traversal / from the host's outcomes — never asserted, never
derived from the input's shape.

## The budget law and the diff boundary

- **The budget law**: a captured view tree deeper than the
  environment's `maxHierarchyDepth` is a NAMED error — nothing is
  observed.
- **The diff boundary**: the verification run's data is the shape the
  diff lane consumes — the paired-run evidence enters the frozen
  `DiffReport` (`@clapp/diff`'s `PairedRun`/`DiffDimension`/
  `DiffSeverity` vocabulary) through the diff lane's **existing**
  machinery. **This adapter never constructs a DiffReport.** The
  journey ids are the `@clapp/journey` vocabulary, run through the host
  seam — never redefined here (TYPE-ONLY consumption).

## Honest scope (v0.1)

- The **contracts** are the deliverable: descriptors, validators, host
  seams, the emitter, measured runs. Real device/emulator bindings
  (`adb`, uiautomator, instrumentation) are deployment scope.
- The environment descriptor is a declared contract, not a device
  probe; the synthesis target's `minApiLevel <= apiLevel` cross-check
  is caller-owned (the validator checks the target's own shape only).
- Fail-closed everywhere: every malformation is a named error with the
  observed value; refusal is the default; results, never exceptions —
  except the loud-host law above (and `canonicalJson`'s deliberate
  throw on non-canonicalizable payloads, inherited unchanged from
  `@clapp/observe`).
- Linux/Windows/macOS/iOS adapters are later lanes (the P8 sequence);
  P9 is out of scope.

## Battery

From the repository root: `bun run typecheck`, `bun run lint`,
`bun test` — the same battery every package answers (see root
`README.md`). Per-package: `bun run typecheck` inside
`packages/android` additionally covers `test/` and `test/fixtures/`.
