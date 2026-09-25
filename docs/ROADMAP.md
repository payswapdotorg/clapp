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
├── ⬜ P2 Behavioral Model
│   ├── ⬜ Behavioral IR
│   ├── ⬜ state/transition extraction
│   ├── ⬜ API contract extraction
│   ├── ⬜ autonomous exploration
│   └── ⬜ journey DSL
│
├── ⬜ P3 Web Synthesis
│   ├── ⬜ architecture planner
│   ├── ⬜ package-aware codegen
│   ├── ⬜ backend/mock generation
│   └── ⬜ generated test suite
│
├── ⬜ P4 Differential Verification
│   ├── ⬜ paired runner
│   ├── ⬜ semantic diff
│   ├── ⬜ visual diff
│   ├── ⬜ network diff
│   ├── ⬜ state/storage diff
│   └── ⬜ autonomous repair loop
│
├── ⬜ P5 Package Library
│   ├── ⬜ package schema
│   ├── ⬜ registry
│   ├── ⬜ extraction
│   ├── ⬜ retrieval
│   ├── ⬜ compatibility graph
│   └── ⬜ promotion/replay gates
│
├── ⬜ P6 Continuous Learning
│   ├── ⬜ failure memory
│   ├── ⬜ repair pattern mining
│   ├── ⬜ archetype detection
│   ├── ⬜ composition planning
│   └── ⬜ improvement benchmarks
│
├── ⬜ P7 Production Hardening
│   ├── ⬜ auth/session boundary
│   ├── ⬜ tenancy
│   ├── ⬜ resource budgets
│   ├── ⬜ secrets/redaction
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
