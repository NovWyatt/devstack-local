# Phase 3.2 Report - Baseline Alignment

**Project:** DevStack Local  
**Phase:** 3.2 (Baseline Alignment)  
**Date:** 2026-04-12

## 1. Scope Completed

Phase 3.2 was completed with no Phase 4 feature work and no UI redesign:

1. Synced PHP metadata/default references to bundled runtime `8.3.30`.
2. Updated `scripts/phase3_real_tests.ts` to match Phase 3.1 rollback behavior.
3. Added one unified verification script in `package.json`.
4. Improved `.gitignore` for runtime-generated artifacts (logs, MySQL data, generated Apache runtime config).

## 2. Implementation Details

## 2.1 PHP metadata/default alignment to 8.3.30

- Updated PHP version catalog entry in main process:
  - `electron/services/php.service.ts`
  - `8.3.29 -> 8.3.30`
- Updated persisted default active PHP version:
  - `electron/utils/config.store.ts`
  - `activePhpVersion: '8.3.29' -> '8.3.30'`
- Updated browser fallback PHP metadata and defaults:
  - `src/stores/usePhpStore.ts`
  - mock installed active version changed to `8.3.30`
  - fallback `activeVersion` default changed to `8.3.30`
  - active fallback in `fetchVersions` changed to `8.3.30`
- Updated download size map:
  - `src/components/php-manager/VersionDownloader.tsx`
  - `8.3.29 -> 8.3.30`
- Corrected unrelated stale default display value:
  - `src/stores/useAppStore.ts`
  - Apache initial version fixed from `8.5.1` to `2.4.62`

## 2.2 Phase 3 real test alignment with Phase 3.1

- Updated scenario:
  - `scripts/phase3_real_tests.ts`
  - old expectation: create succeeds when Apache restart fails
  - new expectation: create fails and rolls back when Apache restart fails
- Added rollback assertions in test:
  - hosts file restored
  - vhost file restored
  - domain storage restored
  - failed domain hostname not persisted

## 2.3 Unified verification script

- `package.json` scripts updated with:
  - `verify`: build + authoritative tests
  - command:
    - `npm run build`
    - `npx tsx scripts/phase2_6_real_tests.ts`
    - `npx tsx scripts/phase3_real_tests.ts`
    - `npx tsx scripts/phase3_1_hardening_tests.ts`

## 2.4 Runtime artifact ignore rules

- `.gitignore` updated with runtime-generated artifact rules while preserving bundled binaries:
  - `resources/binaries/apache/logs/`
  - `resources/binaries/apache/conf/httpd.devstack.conf`
  - `resources/binaries/apache/conf/extra/httpd-devstack-vhosts.conf`
  - `resources/binaries/mysql/data/`
  - `resources/binaries/php/*/php.ini`
  - `resources/binaries/php/*/php.ini.bak`

Note: already tracked files under those paths will still appear modified until untracked separately.

## 3. Verification Run

Command executed:

```bash
npm run verify
```

Result: **PASS**

### Build
- `npm run build`: PASS (`tsc` + `vite build`)

### Authoritative tests
- `scripts/phase2_6_real_tests.ts`: PASS (7/7)
- `scripts/phase3_real_tests.ts`: PASS (5/5, including rollback-on-restart-fail)
- `scripts/phase3_1_hardening_tests.ts`: PASS (6/6)

Updated test artifacts:
- `phase2_6_test_results.json`
- `phase3_test_results.json`
- `phase3_1_test_results.json`

## 4. Files Changed

- `.gitignore`
- `package.json`
- `electron/services/php.service.ts`
- `electron/utils/config.store.ts`
- `src/stores/usePhpStore.ts`
- `src/components/php-manager/VersionDownloader.tsx`
- `src/stores/useAppStore.ts`
- `scripts/phase3_real_tests.ts`
- `phase2_6_test_results.json`
- `phase3_test_results.json`
- `phase3_1_test_results.json`
- `PHASE3_2_REPORT.md` (new)

## 5. Outcome

Phase 3.2 baseline alignment is complete:
- PHP defaults now match bundled runtime (`8.3.30`).
- Legacy Phase 3 test expectation mismatch is resolved.
- Verification has one canonical command.
- Runtime-generated artifacts are better separated via ignore rules.
