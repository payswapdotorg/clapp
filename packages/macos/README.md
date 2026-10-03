# @clapp/macos

CLAPP macOS adapter (**CLAPP-083**, the P8 fourth platform — Worker 1,
Observation and Platform Adapters, per `docs/WORKER_HANDOFFS.md`): the
five platform components `docs/WORK_ITEMS.md` P8 demands, delivered as
v0.1 **contracts** over the frozen core/observe contracts. The Android
(CLAPP-080, `@clapp/android`), Linux (CLAPP-081, `@clapp/linux`), and
Windows (CLAPP-082, `@clapp/windows`) adapters are the landed
five-component pattern this lane follows; the macOS vocabularies differ
per the CLAPP-083 declaration.

> **THE NO-FORK LAW (P8, verbatim from `docs/WORK_ITEMS.md`):**
> "Do not fork the core Behavioral IR."
>
> This package **consumes** the frozen contracts — `@clapp/core`
> (`sha256Hex`; `EVIDENCE_KINDS`, the core's own closed-vocabulary
> mirror) and `@clapp/observe` (`canonicalJson`) at RUNTIME, and
> `@clapp/diff` / `@clapp/ir` / `@clapp/journey` vocabularies through
> their own machinery, TYPE-ONLY — and produces **contract-shaped
> DATA**. It never redefines, rewrites, or forks any IR/contract type.
> `test/macos.test.ts`'s import-discipline test pins this.

## The five components (the P8 law)

| # | Component | Module | Surface |
|---|-----------|--------|---------|
| 1 | environment descriptor | `src/environment.ts` | `MacOSEnvironment`, `MACOS_ENVIRONMENT_VERSION`, `MACOS_ACCESSIBILITY_FRAMEWORKS`, `validateMacOSEnvironment` |
| 2 | observation adapter | `src/observation.ts` | `MacOSViewNode`, `MacOSObservationHost`, `MacOSObservation`, `observeMacOSScreen` |
| 3 | evidence emitter | `src/evidence.ts` | `emitObservationEvidence` |
| 4 | synthesis target | `src/synthesis-target.ts` | `MacOSSynthesisTarget`, `MACOS_TARGET_VERSION`, `MACOS_PACKAGING_FORMATS`, `validateMacOSSynthesisTarget` |
| 5 | verification adapter | `src/verification.ts` | `MacOSVerificationHost`, `MacOSVerificationRun`, `verifyMacOSJourneys` |

`src/index.ts` re-exports the five components' contracts + validators
(the house style).

## The host-seam law (the honest boundary)

Everything environment-specific enters through exactly TWO duck-typed
seams:

- **`MacOSObservationHost`** — `captureScreen(): Promise<MacOSViewNode>`
- **`MacOSVerificationHost`** — `runJourney(journeyId): Promise<{ completed: boolean; failureReason?: string }>`

The seam contracts are the lane's deliverable; the **tests fake them**
(`test/fixtures/fake-hosts.ts`). Real **macOS Accessibility API (AX) /
AppKit / Quartz** bindings (the `AXUIElementRef` tree-walker,
`AXObserver` notifications, the NSWindow/NSView hierarchy,
`CGEvent`-based input synthesis) are **deployment scope** — later
lanes, never this package. A host is admitted only by duck-typing (an
object with the callable method), a malformed capture/outcome is a
named error, and a **throwing host propagates loudly** (the caller's
failure is the caller's — never swallowed, never converted into a
synthetic result; the replay-benchmark precedent).

## The AX law (the honest refusal)

v0.1 observes the macOS desktop through the **Accessibility framework
(AX) or not at all**. An environment whose `accessibilityFramework` is
`'none'` is a **VALID descriptor** — the honest no-framework machine,
never a validator error — but `observeMacOSScreen` **refuses
observation**: a NAMED error, nothing observed, and the host is **never
called** (no framework, no capture — a capture without a framework
would be fabricated evidence).

## Frozen vocabularies (v0.1)

- `MACOS_ENVIRONMENT_VERSION` = `'0.1'`; `MACOS_TARGET_VERSION` = `'0.1'`
- `platform` = `'macos'` (the frozen platform literal on both descriptors)
- `MACOS_ACCESSIBILITY_FRAMEWORKS` (the two accessibility frameworks):
  `ax`, `none` — `ax` (the macOS Accessibility API) is the only
  observing framework in v0.1; `'none'` is the honest no-framework
  descriptor (see the AX law above)
- `MACOS_PACKAGING_FORMATS` (the five packaging formats): `app`,
  `dmg`, `pkg`, `zip`, `universal`

"Sorted" means lexicographic ascending (code-unit order — the default
`Array.prototype.sort()` on strings), the same law for every sorted
vocabulary in this package (`bundleIdentifiers`, `packagingFormats`).

## The prefix discipline

macOS observation evidence ids are minted **content-derived**:
`'mdev_' + screenDigest.slice(0, 32) + '-' + kind` — deterministic, no
uuid, no clock, no randomness (the content-addressed-identity house
law; `mdev_` is this lane's prefix, the way `andev_` is the Android
lane's, `lidev_` the Linux lane's, and `wdev_` the Windows lane's). The
emitted record IS the core's `EvidenceRef` (`@clapp/core` — imported
TYPE-ONLY), with `sha256` carrying the observation's `screenDigest`
verbatim: the capture's own measured digest, never re-asserted. `kind`
must be one of the frozen `EVIDENCE_KINDS` (consumed from the core's
runtime mirror — one source of truth; an unknown kind is a named
error).

## The determinism discipline

No clock, no randomness, no network, no filesystem, no global state.
The same captured tree canonicalizes identically (`canonicalJson`,
sorted keys) and hashes identically (`sha256Hex`, WebCrypto) → the same
`screenDigest` → the same `mdev_` evidence id, forever. Observation
counts (`nodeCount`, `observedDepth`) and verification counts
(`completed`, `failed`) are **MEASURED** — counted by traversal / from
the host's outcomes — never asserted, never derived from the input's
shape.

## The budget law and the diff boundary

- **The budget law**: a captured view tree deeper than the
  environment's `maxHierarchyDepth` is a NAMED error — nothing is
  observed.
- **The diff boundary**: the verification run's data is the shape the
  diff lane consumes — the paired-run evidence enters the frozen
  `DiffReport` (`@clapp/diff`'s `PairedRun`/`DiffDimension`/
  `DiffSeverity` vocabulary) through the diff lane's **existing**
  machinery. **This adapter never constructs a DiffReport.** The
  journey ids are the `@clapp/journey` vocabulary, run through the
  host seam — never redefined here (TYPE-ONLY consumption).

## Honest scope (v0.1)

- The **contracts** are the deliverable: descriptors, validators, host
  seams, the emitter, measured runs. Real macOS AX API/AppKit/Quartz
  bindings (the `AXUIElementRef` tree-walker, `AXObserver`
  notifications, `CGEvent` synthesis, app-bundle/DMG/pkg/universal-
  binary packaging pipelines) are deployment scope.
- The environment descriptor is a declared contract, not a system
  probe (`NSProcessInfo` / AX-framework discovery is deployment
  scope); the synthesis target's `minOsMajor <= osMajor` cross-check
  is caller-owned (the validator checks the target's own shape only).
- Fail-closed everywhere: every malformation is a named error with the
  observed value; refusal is the default; results, never exceptions —
  except the loud-host law above (and `canonicalJson`'s deliberate
  throw on non-canonicalizable payloads, inherited unchanged from
  `@clapp/observe`).
- The iOS adapter is a later lane (the P8 sequence's fifth and final
  platform); P9 is out of scope.

## Battery

From the repository root: `bun run typecheck`, `bun run lint`,
`bun test` — the same battery every package answers (see root
`README.md`). Per-package: `bun run typecheck` inside
`packages/macos` additionally covers `test/` and `test/fixtures/`.
