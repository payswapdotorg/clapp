# CLAPP Roadmap

Legend:
- ✅ completed/frozen
- 🟡 in progress
- ⬜ planned

```
CLAPP
│
├── ✅ P0 Foundation
│   ├── ✅ workspace + CI (CLAPP-001, merged feec678)
│   ├── ✅ persistence/artifact layer (CLAPP-002, merged 234d29f)
│   ├── ✅ sandbox + execution contract (CLAPP-003, merged cc5aa94)
│   └── 🟡 worker orchestration contract (dispatch via replay verified; repo-side contract pending)
│
├── ✅ P1 Web Observation
│   ├── ✅ Playwright runner (@clapp/observe — ObservationRunner + PageDriver, e2e green in chromium)
│   ├── ✅ CDP adapter (playwright-session CDP attach; browser-log channel)
│   ├── ✅ UI/accessibility capture (DOM serializer + role table + a11y semantics)
│   ├── ✅ network/WebSocket capture (request/response/failure + WS frames)
│   ├── ✅ storage/service-worker evidence (ls/ss/cookies/SW/caches/IDB inventories)
│   ├── ✅ evidence manifest + provenance (@clapp/evidence — bundle + rootHash + 11 tamper codes)
│   └── ✅ journey recording/replay (@clapp/journey — b01 corpus + 4 seeded journeys + sandbox proof)
│
├── ✅ P2 Behavioral Model
│   ├── ✅ Behavioral IR (@clapp/ir — contract v0.1 canonical owner, validator, canonical serialize, diff, builder; CLAPP-020)
│   ├── ✅ state/transition extraction (@clapp/extract — evidence→IR pipeline; CLAPP-021)
│   ├── ✅ API contract extraction (@clapp/extract — api operations from network evidence; CLAPP-021)
│   ├── ✅ autonomous exploration (@clapp/explore — deterministic budgeted walks, action-level evidence, IR emission; CLAPP-022)
│   └── ✅ journey DSL (@clapp/journey — action/journey contract + recorder/replayer vocabulary; delivered at P1, frozen with the P1 surface)
│
├── ✅ P3 Web Synthesis
│   ├── ✅ architecture planner (@clapp/plan — synthesis-contract v0.1 canonical owner; CLAPP-030)
│   ├── ✅ package-aware codegen (@clapp/codegen; CLAPP-031)
│   ├── ✅ backend/mock generation (@clapp/codegen mock backend; CLAPP-031)
│   └── ✅ generated test suite (@clapp/gentests; CLAPP-032)
│
├── ✅ P4 Differential Verification
│   ├── ✅ paired runner (@clapp/diff — runPair/diff/report spine, dom + playwright drivers; CLAPP-040)
│   ├── ✅ semantic diff (@clapp/diff semantic dimension; CLAPP-040)
│   ├── ✅ visual diff (@clapp/diffext; CLAPP-041)
│   ├── ✅ network diff (@clapp/diffext; CLAPP-041)
│   ├── ✅ state/storage diff (@clapp/diff state dimension; CLAPP-040)
│   └── ✅ autonomous repair loop (@clapp/repair; CLAPP-042)
│
├── ✅ P5 Package Library
│   ├── ✅ package schema (manifest v0.1, validator, canonical serialization, content-addressed ids — @clapp/library; CLAPP-050)
│   ├── ✅ registry (in-memory fail-closed store, immutable (id,version) keys, creg_ snapshots — @clapp/library; CLAPP-055)
│   ├── ✅ extraction (fail-closed unverified-candidate gate over the frozen P4 ports — @clapp/library; CLAPP-050)
│   ├── ✅ retrieval (ranked candidates over measured manifest signals, rq_ query digest — @clapp/library; CLAPP-052)
│   ├── ✅ compatibility graph (deterministic pairwise verdicts, cgraph_ content-addressed identity — @clapp/library; CLAPP-051)
│   └── ✅ promotion/replay gates (replay benchmark CLAPP-053 + promotion gate CLAPP-054, the tech lead's lane — candidate→replayed over chain-intact green evidence — @clapp/library)
│
├── ✅ P6 Continuous Learning
│   ├── ✅ failure memory (fail-closed event store over the frozen diff/repair vocabulary, fail_/fmem_ identities — @clapp/learn; CLAPP-060)
│   ├── ✅ repair pattern mining (signature grouping, measured support, three-status cascade, rpat_ candidates — @clapp/learn; CLAPP-061)
│   ├── ✅ archetype detection (the frozen five-rule table over manifest facts, arch_ classifications — @clapp/learn; CLAPP-062)
│   ├── ✅ composition planning (greedy rank-ordered selection over the frozen retrieval + compat verdicts, comp_ plans — @clapp/learn; CLAPP-063)
│   └── ✅ improvement benchmarks (the acceptance harness: measured plan deltas over ordered snapshots, honest verdict cascade, bench_ reports — @clapp/learn; CLAPP-064, the tech lead's lane)
│
├── 🟡 P7 Production Hardening
│   ├── ✅ auth/session boundary (the §1 five-kind statement capture, per-target observation gate, authz_ sessions — @clapp/security; CLAPP-070)
│   ├── ⬜ tenancy
│   ├── ⬜ resource budgets
│   ├── ✅ secrets/redaction (the §3 six-class vocabulary, visible non-reversible markers, redct_ provenance — @clapp/security; CLAPP-071)
│   └── ⬜ auditability
│
├── ⬜ P8 Native Adapters
│   ├── ⬜ Android
│   ├── ⬜ Linux
│   ├── ⬜ Windows
│   ├── ⬜ macOS
│   └── ⬜ iOS
│
└── ⬜ P9 Autonomous App Factory
    ├── ⬜ target classification
    ├── ⬜ adaptive exploration budgets
    ├── ⬜ package-graph synthesis
    ├── ⬜ multi-pass repair
    └── ⬜ human release gate
```
