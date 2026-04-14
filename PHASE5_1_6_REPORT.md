# Phase 5.1.6 Report - Electron Native Dependency Build Fix

**Project:** DevStack Local  
**Phase:** 5.1.6  
**Date:** 2026-04-14

## Scope

This pass was limited to the Electron native-dependency build unblock only.

Explicitly not done:

- no Phase 5.2 work
- no product features
- no UI redesign
- no speculative refactors

## Exact Root Cause of `cpu-features` Entering the Electron Bundle

The current Electron build path imports `ssh2-sftp-client` from:

- `electron/services/remote.service.ts`

That dependency chain is:

- `electron/services/remote.service.ts`
- `ssh2-sftp-client`
- `ssh2`
- `ssh2/lib/protocol/constants.js`
- optional `require('cpu-features')()`
- `cpu-features/lib/index.js`
- `../build/Release/cpufeatures.node`

Why the failure happened:

- the Electron Vite config only marked `electron` as external
- Rollup therefore tried to bundle main-process runtime dependencies into `dist-electron/main.js`
- bundling walked into `ssh2` and reached the optional native `cpu-features` addon path
- `cpu-features` exposes a native `.node` binary through:
  - `require('../build/Release/cpufeatures.node')`
- Rollup/Vite cannot bundle that native addon path into the Electron main bundle

That is the exact reason the latest clean-environment build failed with:

- `Could not resolve "../build/Release/cpufeatures.node"`

Downstream effect:

- Electron main build aborts
- `dist-electron/main.js` is not produced
- packaging then fails because the packaged app entry file is missing

## Exact Config Change That Fixed It

Updated:

- `vite.config.ts`

Exact change:

- read `package.json` dependencies once at config load
- build a predicate that treats every runtime dependency name and dependency subpath as external
- apply that predicate to both Electron build entries:
  - `electron/main.ts`
  - `electron/preload.ts`

What this does:

- keeps runtime Node dependencies external to the Rollup bundle
- prevents Rollup from traversing `ssh2-sftp-client -> ssh2 -> cpu-features`
- preserves runtime behavior by letting Electron/Node load those packages normally from packaged `node_modules`

Why this is the smallest safe fix:

- it changes only Electron bundling behavior
- it does not alter remote-service logic
- it does not remove or replace `ssh2-sftp-client`
- it matches the plugin's documented guidance for native Node modules

## Required Gate Re-run Results In This Session

### `npm run verify`

Result: **FAIL**

Observed failure in this shell:

- Vite config loading still fails first with `Error: spawn EPERM`

### `npm run smoke:packaged`

Result: **FAIL**

Observed failure in this shell:

- smoke reaches the build step and then fails with `spawn EPERM`

### `npx electron-builder -- --win nsis --publish never --config.win.signAndEditExecutable=false`

Result: **FAIL**

Observed failure in this shell:

- `electron-builder` still fails launching `app-builder.exe` with `spawn EPERM`

## Output Status

Was `dist-electron/main.js` re-confirmed locally in this shell after the fix?

**No.**

Reason:

- this shell still fails earlier on the Windows `spawn EPERM` blocker before the Electron build can complete

Was `dist-electron/preload.js` re-confirmed locally in this shell after the fix?

**No.**

Reason:

- same environment-level `spawn EPERM` blocker

## Final Status

Exact root cause of `cpu-features` entering the Electron bundle:

- Electron main-process Rollup config was bundling runtime dependencies instead of externalizing them, which pulled `ssh2`'s optional native `cpu-features` addon into the bundle graph

Exact config change that fixed it:

- Electron main/preload Vite builds now externalize all runtime `package.json` dependencies by name/subpath in `vite.config.ts`

Are all three required gates green in this shell?

**No.**

Can Phase 5.2 start?

**No.**

Reason:

- the repo-side native bundling fix is implemented, but this shell still cannot complete the required gate reruns because Windows child-process spawning continues to fail with `EPERM`
