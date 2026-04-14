# Phase 5.1.3 Report - Final Packaging Gate Fix

**Project:** DevStack Local  
**Phase:** 5.1.3 (packaging/runtime unblock only)  
**Date:** 2026-04-14

## 1. Scope

This session stayed inside Phase 5.1.3 only:

1. Re-inspect the current packaging config and effective runtime/build behavior.
2. Determine whether `npmRebuild=false` is actually being honored by `electron-builder`.
3. Fix the remaining packaged `__dirname` runtime failure at the build pipeline level.
4. Preserve smoke fail-fast behavior and tighten it against stale Electron bundle output.
5. Re-run the required gates and document the exact final status.

Explicitly not done:

- no Phase 5.2 work
- no UI redesign
- no new product features

## 2. Root Cause: `cpu-features` Rebuild Concern

Re-confirmed dependency path:

- `ssh2-sftp-client@12.1.1`
- `ssh2@1.17.0`
- `cpu-features@0.0.10`

Re-confirmed runtime status:

- `cpu-features` is still optional
- `ssh2` wraps it in a `try/catch`
- it is used only as an optimization hint for crypto/cipher ordering

What was inspected:

- `package.json`
- `electron-builder.json`
- `node_modules/app-builder-lib/out/packager.js`
- direct `electron-builder` output

Exact finding:

- in the current repo state, `electron-builder` **is** honoring `npmRebuild=false`
- direct packaging logs:
  - `loaded configuration file=...electron-builder.json`
  - `skipped dependencies rebuild reason=npmRebuild is set to false`

Exact root cause of the remaining packaging failure:

- it is **not** a continuing `cpu-features` rebuild
- packaging now fails later when `electron-builder` tries to spawn `app-builder.exe`
- this session's Windows environment returns:
  - `Cannot spawn ... app-builder.exe: Error: spawn EPERM`

Conclusion:

- the previous `cpu-features` rebuild issue is already neutralized in the current effective config
- no additional repo-side rebuild suppression was needed beyond the existing `npmRebuild=false`

## 3. Exact Root Cause: Packaged `__dirname` Runtime Failure

The source fix from Phase 5.1.2 was correct but incomplete in practice because the normal build pipeline never rebuilt Electron output.

What was found:

- `electron/main.ts` no longer uses `__dirname`
- `dist-electron/main.js` still did use `__dirname`
- `electron/main.ts` was newer than `dist-electron/main.js`

Why this happened:

- `vite.config.ts` only enables `vite-plugin-electron` when `mode === 'electron'`
- the old `npm run build` executed plain `vite build`
- plain `vite build` rebuilt the renderer only
- Electron main/preload under `dist-electron/` were left stale from older runs
- packaging then consumed stale `dist-electron/main.js`, which still contained:
  - `preload: path.join(__dirname, 'preload.js')`
  - `mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))`

That is the exact reason packaged runtime still crashed with:

- `ReferenceError: __dirname is not defined`

Implemented fix:

- `package.json` `build` now runs:
  - `vite build --mode electron`
- the build also clears `dist-electron` first so stale Electron bundle output is removed before rebuild

## 4. Smoke Hardening

The fail-fast smoke behavior was kept and tightened.

Changes:

- `release/` cleanup remains first
- smoke still stops on the first required-step failure
- smoke now verifies built Electron outputs exist:
  - `dist-electron/main.js`
  - `dist-electron/preload.js`
- smoke now fails if either built Electron bundle still contains:
  - `__dirname`
  - `__filename`

This closes the stale-bundle gap that allowed the Phase 5.1.2 source fix to exist without reaching packaged output.

## 5. Required Toolchain Notes

Recommended packaging baseline:

- Node 22 LTS
- npm bundled with that Node install

If native rebuilds are deliberately re-enabled in the future:

- Python 3
- Visual Studio Build Tools 2022
- Desktop C++ workload for `node-gyp`

Current direct-builder observation:

- the repo's existing `npmRebuild=false` is effective and prevents the optional `cpu-features` rebuild path

## 6. Required Gate Results

## 6.1 `npm run verify`

Result in this session: **FAIL**

Failure:

- `vite` still cannot load `vite.config.ts` here because esbuild child-process startup returns `spawn EPERM`

## 6.2 `npm run smoke:packaged`

Result in this session: **FAIL**

Observed behavior:

- stale `release/` cleanup: PASS
- build step fails immediately with `spawn EPERM`
- smoke exits without running stale packaged checks

## 6.3 `npx electron-builder -- --win nsis --publish never --config.win.signAndEditExecutable=false`

Result in this session: **FAIL**

Observed behavior:

- config file is loaded
- dependency rebuild is skipped:
  - `npmRebuild is set to false`
- packaging then fails at:
  - `app-builder.exe`
  - `spawn EPERM`

## 7. Final Assessment

Repo-side packaging/runtime fixes now cover:

- correct effective build path for Electron bundles
- stale `dist-electron` cleanup
- smoke validation against remaining CommonJS path globals in built Electron output
- confirmation that `cpu-features` rebuild suppression is already active in the current effective config

However, the mandatory gates are **not all green in this session** because this Windows environment still blocks Node/Electron child-process execution.

## 8. Are All Packaging Gates Finally Green?

**No, not in this session.**

What is green from the repo analysis side:

- `cpu-features` rebuild suppression is active
- the real packaged runtime root cause has been identified and fixed at the build-pipeline level

What is still blocked here:

- `npm run verify`
- `npm run smoke:packaged`
- direct NSIS packaging

All three are still blocked by Windows `spawn EPERM` on this machine before end-to-end packaging/runtime verification can complete.
