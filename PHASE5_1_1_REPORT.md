# Phase 5.1.1 Report - Windows EPERM Stabilization

**Project:** DevStack Local  
**Phase:** 5.1.1 (stabilization only)  
**Date:** 2026-04-14

## 1. Scope

This session stayed inside Phase 5.1.1 only:

1. Recover the previous session state safely.
2. Re-check the git lock condition before touching repo state.
3. Inspect the current repo for existing Phase 5.1.1 stabilization work.
4. Re-run the required verification and packaging gates.
5. Isolate the remaining Windows `EPERM` blockers without widening app scope.
6. Clean stale tracked temp/cache artifacts created by earlier Phase 5 work.

Explicitly not done:

- no Phase 5.2 work
- no UI redesign
- no weakening of strict TypeScript
- no changes to previous stable phase behavior to fake a green result

## 2. Recovery and Repo State

Initial checks:

- `SESSION_HANDOFF.md` and `PHASE5_1_REPORT.md` were reviewed first.
- `.git/index.lock` did **not** exist on this machine, so no lock removal was needed.
- `git status` was clean before new stabilization edits.

Current Phase 5.1.1-related state found in the repo:

- Phase 5.1 feature files were already present in `HEAD`.
- The last commit also contained stale tracked build/cache artifacts:
  - `.npm-cache/**`
  - `.tmp-phase5-esm-run/**`
  - `.tmp-phase5-tests-run/**`
  - `tsconfig.node.tsbuildinfo`

Those files are not product code and should not remain tracked.

## 3. Verification Re-Runs

## 3.1 `npm run verify`

Re-run result: **FAIL**

Failure point:

- `vite build` failed while Vite/esbuild tried to start its service process.
- Error:
  - `Error: spawn EPERM`
  - source path inside failure:
    - `node_modules/esbuild/lib/main.js`
    - `ensureServiceIsRunning(...)`

## 3.2 `npm run smoke:packaged`

Re-run result: **FAIL**

Primary failure point:

- `npx tsx scripts/phase3_3_packaged_smoke.ts`
- failed before the smoke script could start
- error:
  - `Error [TransformError]: spawn EPERM`
  - source path inside failure:
    - `node_modules/tsx/node_modules/esbuild/lib/main.js`

Direct packaging probe result:

- `npx electron-builder --win --dir --publish never --config.win.signAndEditExecutable=false`
- failed with:
  - `Cannot spawn ... app-builder.exe: Error: spawn EPERM`

This means packaged smoke is blocked before the actual packaged launch check can complete.

## 3.3 Additional isolation probes

What passed:

- Direct PowerShell execution of the esbuild binary:
  - `.\node_modules\@esbuild\win32-x64\esbuild.exe --version`
  - PASS
- `node --experimental-strip-types scripts/phase5_1_real_tests.ts`
  - PASS

What failed:

- Plain Node `child_process.spawn()` of:
  - `cmd.exe`
  - `powershell.exe`
  - `esbuild.exe`
- Electron runtime `child_process.spawn()` probe
- Bundled Phase 2.6 real test runner when starting Apache/MySQL/PHP-CGI

Observed pattern:

- launching binaries directly from the shell works
- launching child processes from Node/Electron returns `spawn EPERM`

Conclusion:

- the blocker is broader than Vite or `tsx`
- the current machine is rejecting Node/Electron child-process creation
- this affects:
  - Vite/esbuild
  - `tsx`
  - real service-start tests
  - `electron-builder`

## 4. Cleanup Applied

Stabilization cleanup completed:

- Added ignore coverage for:
  - `.npm-cache/`
  - `.npm-cache-local/`
  - `.tmp-phase5-esm-run/`
  - `.tmp-phase5-tests-run/`
  - `.tmp-verify-probe/`
  - `.tools/`
  - `*.tsbuildinfo`
- Identified stale tracked temp/cache artifacts that should be removed from git tracking:
  - `.npm-cache/**`
  - `.tmp-phase5-esm-run/**`
  - `.tmp-phase5-tests-run/**`
  - `tsconfig.node.tsbuildinfo`

Git cleanup status:

- attempted `git rm` cleanup was blocked because this session cannot create `.git/index.lock`
- `.git` has an explicit Windows ACL deny entry preventing write access from this session
- the tracked temp/cache files therefore remain staged for later cleanup by a session that can write into `.git`

## 5. Outcome

Phase 5.1.1 did identify and narrow the remaining blocker correctly:

- this is **not** a stale `.git/index.lock` problem
- this is **not** limited to Vite config loading
- this is **not** a Phase 5.1 remote-manager logic regression

The remaining blocker is a Windows environment/policy issue preventing Node/Electron child-process launches with `EPERM`.

Additional repository-management blocker:

- staging and commit are also blocked in this session because `.git` is write-protected by Windows ACLs, which prevents `index.lock` creation

## 6. Required Next Step

To finish the requested verification gates for Phase 5.1.1:

1. run `npm run verify` on a Windows environment where Node/Electron child-process spawning is permitted
2. run `npm run smoke:packaged` on that same environment
3. only after those two gates pass, consider Phase 5.1.1 fully closed
