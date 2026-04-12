# PROJECT AUDIT (CURRENT)

Date: 2026-04-12  
Repository: `devstack-local`

## 1) Audit Scope and Method

This audit covered:
- `electron/` (main process, services, runtime utilities, IPC)
- `src/` (renderer UI, stores, routes, types)
- `scripts/` (real and hardening test runners)
- `resources/` (bundled Apache/MySQL/PHP assets and mutable runtime artifacts)
- Project config and reports:
  - `README.md`
  - `PHASE1_REPORT.md`
  - `PHASE2_REPORT.md`
  - `PHASE2_5_REPORT.md`
  - `PHASE2_6_REPORT.md`
  - `PHASE3_REPORT.md`
  - `PHASE3_1_REPORT.md`
  - `phase2_6_test_results.json`
  - `phase3_test_results.json`
  - `phase3_1_test_results.json`
  - `package.json`, `tsconfig*.json`, `vite.config.ts`, `electron-builder.json`, `tailwind.config.js`, `postcss.config.js`

Verification commands executed:
- `npm run build`
- `npx tsx scripts/phase2_6_real_tests.ts`
- `npx tsx scripts/phase3_real_tests.ts`
- `npx tsx scripts/phase3_1_hardening_tests.ts`

## 2) Current Codebase Structure

## Core directories
- `electron/`
  - `main.ts` (BrowserWindow lifecycle + IPC handlers)
  - `preload.ts` (contextBridge API)
  - `services/` (`process.manager.ts`, `apache.service.ts`, `mysql.service.ts`, `php.service.ts`, `domain.service.ts`)
  - `utils/` (`config.store.ts`, `port.util.ts`, `retry.util.ts`, `binary.util.ts`, `runtime.validation.ts`)
- `src/`
  - `App.tsx` + route layout
  - `components/` (dashboard, php manager, domains manager, layout, shared)
  - `stores/` (`useAppStore`, `usePhpStore`, `useDomainStore`)
  - `types/` shared domain/php/app IPC types
- `scripts/`
  - `phase2_6_real_tests.ts`
  - `phase3_real_tests.ts`
  - `phase3_1_hardening_tests.ts`
- `resources/binaries/`
  - `apache/`, `mysql/`, `php/8.3.30`

## Size and composition snapshot
- TS/TSX files across `electron/src/scripts`: 38
- Files under `resources/`: 1523
- `resources/` total size: ~1.42 GB

## 3) Implemented Phases Summary

## Phase 1
- Implemented and functional.
- Dashboard + service cards + logs + navigation are in place.

## Phase 2
- Implemented and functional.
- PHP Manager UI with versions/php.ini/extensions integrated via IPC.

## Phase 2.5
- Implemented and functional.
- Electron main process uses real process control for Apache/MySQL/PHP-CGI.
- Config persistence via `electron-store`.

## Phase 2.6
- Implemented and functional.
- Hardening features added: bounded restart, readiness validation, health checks, binary validation, port checks, bounded log buffer.

## Phase 3
- Implemented and functional.
- Domains manager and vhost/hosts synchronization added.

## Phase 3.1
- Implemented and functional.
- Domains write lock + rollback + Apache syntax pre-check + stronger validation implemented.

## Phase 4
- Not started as a dedicated phase.
- Some "real runtime" pieces already exist (from 2.5/2.6), but critical production-completion gaps remain (see risks and blockers).

## 4) Architecture Summary

## Runtime model
- Electron main process is the authority for service lifecycle and filesystem/system changes.
- Renderer is thin UI/state layer calling IPC.

## Main process architecture
- `ProcessManager` centralizes process spawn/stop/restart/health monitoring and IPC log/status/error broadcast.
- Service modules:
  - `ApacheService`: binary resolution, runtime config patching, startup HTTP readiness checks.
  - `MySQLService`: binary resolution, optional data initialization, graceful shutdown fallback to force stop.
  - `PhpService`: PHP catalog, active version switching, php.ini read/write, extension toggles, PHP-CGI lifecycle.
  - `DomainService`: domains CRUD, hosts managed block updates, vhost generation, rollback semantics, serialized writes.

## Renderer architecture
- Zustand stores split by concern:
  - `useAppStore` (Apache/MySQL status + logs)
  - `usePhpStore` (PHP manager state/actions)
  - `useDomainStore` (domains CRUD form/list actions)
- React Router routes:
  - Implemented: `/`, `/php-manager`, `/domains`
  - Placeholders: `/database`, `/ssh-ftp`, `/system-logs`, `/tunnel`, `/settings`

## 5) Real vs Mock Services

## Electron mode
- Apache: real process management.
- MySQL: real process management.
- PHP-CGI: real process management.
- Domain hosts/vhost writes: real filesystem writes.
- PHP download: still simulated progress + local directory/ini creation (not real remote zip extraction).

## Browser mode
- Apache/MySQL start/stop are mocked in renderer.
- PHP operations are mostly mocked fallback in renderer store.
- Domains IPC unavailable (returns IPC unavailable errors).

## 6) Verification Results

## Build and typecheck
- `npm run build`: PASS
  - `tsc` succeeded.
  - `vite build` succeeded.

## Test scripts (current run)
- `npx tsx scripts/phase2_6_real_tests.ts`: PASS (all 7 scenarios)
  - Real Apache/MySQL/PHP-CGI start/health checks passed.
  - Crash restart limits, stop cleanup, port conflict messaging, missing-binary messaging passed.
- `npx tsx scripts/phase3_1_hardening_tests.ts`: PASS (all 6 scenarios)
  - Rollback, mutex serialization, path/hostname validation, syntax-failure rollback, managed-block isolation passed.
- `npx tsx scripts/phase3_real_tests.ts`: PARTIAL (4 pass, 1 fail)
  - Failing case expects old behavior ("create succeeds when Apache restart fails"), but 3.1 now enforces rollback on restart/syntax failure.

## 7) Service/Runtime Stability Summary

Current implementation includes meaningful hardening:
- Bounded auto-restart with backoff and max attempts.
- Runtime readiness probes for Apache/MySQL/PHP-CGI.
- Health monitor loop in process manager.
- Port availability/listening checks.
- Binary existence/executability checks.
- Domain write serialization + snapshot rollback on failure.
- Apache syntax validation before restart in domain apply flow.

Net: runtime architecture is materially stronger than early phase reports imply.

## 8) Existing Known Risks and Technical Debt

## Critical / high impact
1. Packaging config currently does not include runtime binaries.
   - `electron-builder.json` includes only `dist/**/*` and `dist-electron/**/*`.
   - No `extraResources` for `resources/binaries`.
   - Packaged builds can fail to run real services without external manual setup.

2. Packaging icon path points to missing file.
   - `electron-builder.json` references `public/icon.ico`, but file is absent.

3. PHP catalog/default mismatch with bundled runtime.
   - Bundled PHP under `resources/binaries/php/8.3.30`.
   - `PhpService` catalog still centered on `8.3.29`.
   - `ConfigStore` default active version is `8.3.29`.
   - This causes UI/state inconsistency (active version can be "active" while not actually installed in bundled assets).

4. Runtime mutable artifacts are tracked in repository.
   - Starting/stopping services mutates tracked files under:
     - `resources/binaries/apache/conf/httpd.devstack.conf`
     - `resources/binaries/apache/logs/*`
     - `resources/binaries/mysql/data/*`
   - Test runs dirty the repo and can obscure real code changes.

## Medium impact
5. Test suite alignment gap.
   - `phase3_real_tests.ts` still encodes pre-3.1 expectations for restart-failure behavior.
   - `phase3_test_results.json` now includes a failure due to outdated expectation.

6. Missing standard test scripts in `package.json`.
   - No unified `npm test` / `npm run verify` command.
   - Verification is currently manual and script-name specific.

7. README/report drift.
   - README roadmap and behavior notes lag behind current real-service state.
   - Historical reports conflict with current behavior in some places.

8. Mutable runtime/data location is repo-local.
   - Apache runtime conf/logs and MySQL data live in `resources/binaries` inside repo.
   - This is fragile for multi-session development and version control hygiene.

## 9) Code Quality Assessment

## Strengths
- Strict TypeScript compile passes.
- Clear service boundaries in Electron main.
- Good defensive checks around process lifecycle.
- Domain hardening (mutex + rollback + syntax validation) is robust.

## Weaknesses
- Functional drift between docs/tests and implementation.
- Packaging/deployment path is incomplete for production distribution.
- PHP version metadata is not synchronized with bundled binaries.
- Runtime state mixed with source-controlled assets.

## 10) Missing Docs and Context Gaps

- `PROJECT_CONTEXT.md` is empty.
- `SESSION_HANDOFF.md` was empty before this audit update.
- No single up-to-date "current architecture truth" doc existed before this file.
- No documented verification matrix mapping which scripts are authoritative by phase.

## 11) Safest Next Immediate Task

**Recommended immediate task (single safest step):**

Stabilize baseline consistency before any Phase 4 feature work by performing a **Phase 3.2 baseline alignment pass**:
- Align PHP catalog/default version with bundled runtime (`8.3.30`) and ensure UI reflects actual installed versions.
- Update outdated `phase3_real_tests.ts` expectation to match 3.1 rollback semantics.
- Add a single scripted verification entrypoint in `package.json` (build + current tests).

Reason: this is low-risk, architecture-preserving, and removes ambiguity before deeper phase work.

## 12) Proposed Phase 4 Breakdown (Small Milestones)

1. **M4.1 Baseline alignment and test green**
   - Fix PHP catalog/default mismatch.
   - Reconcile phase3 legacy test behavior.
   - Add canonical verification script(s).

2. **M4.2 Runtime data isolation**
   - Move mutable runtime outputs (Apache runtime conf/logs, MySQL data) out of tracked repo paths into user/app data directories.
   - Keep shipped binaries read-only.

3. **M4.3 Packaging correctness**
   - Include required binaries/resources in packaging configuration.
   - Fix missing icon and validate installer build end-to-end.
   - Verify runtime path resolution in packaged mode.

4. **M4.4 Real PHP binary lifecycle**
   - Replace simulated PHP download with real download + checksum + extraction + rollback-safe install.

5. **M4.5 Operational controls and diagnostics**
   - Expose ports/binary paths/auto-restart in settings UI.
   - Add clearer health/restart diagnostics in UI logs.

6. **M4.6 Hardening regression suite**
   - Add packaged-mode smoke tests and persistent-data migration checks.

## 13) What Should Be Fixed Before Starting Phase 4

Must-fix first:
- PHP version/catalog default mismatch.
- Outdated phase3 legacy test expectation mismatch.
- Packaging config gaps (resources + icon).

Should-fix early:
- Runtime mutable artifacts tracked in repo.
- Verification command standardization and doc refresh.

## 14) Current Working Tree Notes (Post-Verification)

Running real-service verification scripts in this audit session changed runtime artifacts under `resources/binaries` and refreshed test result JSONs. This is expected with the current architecture but confirms the repo-hygiene risk described above.
