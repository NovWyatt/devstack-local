# Phase 5.1.2 Report - Packaged Build + Runtime Unblock

**Project:** DevStack Local  
**Phase:** 5.1.2 (packaging/runtime unblock only)  
**Date:** 2026-04-14

## 1. Scope

This session stayed inside Phase 5.1.2 only:

1. Identify the dependency path behind `cpu-features@0.0.10`.
2. Determine whether that native module is required at runtime.
3. Fix the packaged Electron `__dirname` crash without widening app scope.
4. Fix packaged smoke correctness so stale `release/` output cannot mask failures.
5. Re-run the required verification gates and document the final status.

Explicitly not done:

- no Phase 5.2 work
- no UI redesign
- no new features
- no broad process/runtime architecture changes outside packaging/runtime unblock

## 2. Root Cause: `cpu-features` Packaging Failure

Dependency chain:

- `ssh2-sftp-client@12.1.1`
- `ssh2@1.17.0`
- `cpu-features@0.0.10`

Evidence:

- `npm ls cpu-features` resolves the package only through `ssh2-sftp-client -> ssh2 -> cpu-features`
- `node_modules/ssh2/package.json` declares `cpu-features` under `optionalDependencies`
- `node_modules/ssh2/lib/protocol/constants.js` wraps `require('cpu-features')()` in a `try/catch`

Conclusion:

- `cpu-features@0.0.10` is **optional at runtime**
- `ssh2` uses it only for crypto/cipher capability ordering
- the app does **not** require it to connect over SFTP or to boot normally

Exact packaging failure cause:

- `electron-builder` was attempting its default native dependency rebuild pass
- that rebuild walks the production dependency graph and reaches the optional `cpu-features` native addon through `ssh2`
- `cpu-features` is a `node-gyp` addon with an install script that requires a local native build toolchain
- rebuilding that optional addon is unnecessary for this app and created a packaging blocker

Implemented fix:

- set `"npmRebuild": false` in `electron-builder.json`

Observed effect:

- the required builder command now logs:
  - `skipped dependencies rebuild reason=npmRebuild is set to false`
- the previous dependency rebuild path is no longer the active failure point in this session

## 3. Root Cause: Packaged `__dirname` Crash

Exact failure cause:

- the repo ships Electron output as ESM (`"type": "module"` in `package.json`)
- `electron/main.ts` still used CommonJS globals:
  - `__dirname` for `preload.js`
  - `__dirname` for `../dist/index.html`
- in packaged ESM output, `__dirname` is undefined, causing `ReferenceError: __dirname is not defined`

Implemented fix:

- kept the Electron output strategy as ESM
- replaced raw `__dirname` usage in `electron/main.ts` with:
  - `const electronEntryDir = path.dirname(fileURLToPath(import.meta.url))`
- updated both preload path resolution and renderer `index.html` loading to use `electronEntryDir`

Search result:

- no raw `__dirname` / `__filename` assumptions remain under `electron/`, `scripts/`, or `src/`

## 4. Smoke Script Correctness Fixes

Changes applied to `scripts/phase3_3_packaged_smoke.ts`:

- delete `release/` before any build/package step starts
- fail immediately on the first required step failure instead of continuing into stale checks
- stop validating `win-unpacked` resources after a build/package failure
- invoke npm through the current Node executable and `npm_execpath`, avoiding batch-wrapper ambiguity
- update runtime-path import to explicit `.ts` so the smoke script works under `node --experimental-strip-types`

Script entrypoint change:

- `package.json` now runs packaged smoke with:
  - `node --experimental-strip-types scripts/phase3_3_packaged_smoke.ts`

Observed effect:

- `npm run smoke:packaged` now clears stale `release/` output first
- when build fails, smoke exits immediately and does not produce false PASS steps from old `win-unpacked` artifacts

## 5. Local Toolchain Constraints

Recommended local baseline for verification/packaging:

- Node 22 LTS
- npm matching the active Node LTS install

If native rebuilds are intentionally re-enabled:

- Python 3
- Visual Studio Build Tools 2022
- Desktop development with C++ workload
- working `node-gyp` toolchain

With the current repo configuration:

- packaged builds no longer rely on rebuilding the optional `cpu-features` addon

## 6. Required Gate Results

## 6.1 `npm run verify`

Result: **FAIL**

Current failure:

- `vite build` cannot start esbuild during config loading
- error:
  - `Error: spawn EPERM`

## 6.2 `npm run smoke:packaged`

Result: **FAIL**

Current behavior:

- stale `release/` output is cleaned first: PASS
- smoke then fails immediately during `npm run build`
- error:
  - `spawn EPERM`

This is the intended fail-fast behavior and no stale packaged resource checks were allowed to run afterward.

## 6.3 `npx electron-builder -- --win nsis --publish never --config.win.signAndEditExecutable=false`

Result: **FAIL**

Current behavior:

- dependency rebuild is skipped correctly:
  - `skipped dependencies rebuild reason=npmRebuild is set to false`
- packaging progresses past the old rebuild path
- the next blocker on this machine is:
  - `Cannot spawn ... app-builder.exe: Error: spawn EPERM`

This means the `cpu-features` rebuild blocker has been removed from the packaging path, but Windows still blocks Node/Electron child-process execution for `app-builder.exe` in this session.

## 7. Final Assessment

Phase 5.1.2 code changes are in place for:

- optional `cpu-features` rebuild avoidance
- ESM-safe Electron runtime path resolution
- packaged smoke cleanup/fail-fast correctness

However, the mandatory packaging/runtime gates are **not green in this session** because the current Windows environment still rejects Node/Electron child-process spawns with `EPERM`.

## 8. Is Phase 5.2 Safe To Start?

**No.**

Reason:

- `npm run verify` is not passing in this environment
- `npm run smoke:packaged` is not passing in this environment
- the explicit NSIS builder command is not passing in this environment
- packaged launch/exit could not be re-verified end-to-end here after the code fix because the environment blocks the build pipeline before that point

The next required step is to re-run the three mandatory gates on a Windows environment where Node/Electron child-process spawning is permitted.
