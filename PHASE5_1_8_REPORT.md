# Phase 5.1.8 Report - Final Electron Build Externalization Closure

**Project:** DevStack Local  
**Phase:** 5.1.8  
**Date:** 2026-04-14

## Scope

This pass stayed inside Electron/Vite build-pipeline closure only.

Explicitly not done:

- no Phase 5.2 work
- no product features
- no UI redesign
- no speculative refactors outside build/package closure

## Actual Electron Build Path

Current `npm run build` path:

1. `tsc`
2. clear `dist-electron/`
3. load `vite.config.ts` directly through `node --experimental-strip-types`
4. call the Vite JavaScript API with `configFile=false`
5. top-level Vite build runs
6. `vite-plugin-electron` `closeBundle` starts nested builds for:
   - `electron/main.ts`
   - `electron/preload.ts`

That means `dist-electron/main.js` and `dist-electron/preload.js` are emitted by the nested Electron builds, not by `tsc`.

## Exact Reason `cpufeatures.node` Was Still Entering Rollup

The remaining gap was in how the Electron external matcher interpreted module IDs.

The previous matcher was still too literal:

- it checked clean dependency IDs and clean `.node` suffixes
- it did not normalize Rollup/Vite CommonJS-decorated IDs first

In the Electron build path, native and CommonJS imports can reach `rollupOptions.external` with extra decoration, for example:

- leading virtual prefixes such as `\0`
- Vite ID wrappers such as `/@id/`
- CommonJS proxy/external prefixes such as `commonjs-external:` or `commonjs-proxy:`
- query/hash suffixes such as `?commonjs-proxy`

That matters for the failing chain:

1. `electron/services/remote.service.ts` imports `ssh2-sftp-client`
2. `ssh2-sftp-client` depends on `ssh2`
3. `ssh2/lib/protocol/constants.js` optionally loads `cpu-features`
4. `cpu-features/lib/index.js` requires `../build/Release/cpufeatures.node`

If Rollup sees a decorated form of that native ID, the old literal `.endsWith('.node')` check does not fire. Once that happens, Rollup continues resolving into the native addon path and fails on `../build/Release/cpufeatures.node`. The error text shows the cleaned path, but the matcher decision happens earlier on the decorated ID.

## Exact Config Fix That Stopped It

Updated:

- `vite.config.ts`

Exact fix:

- normalize Electron build module IDs before external checks by removing:
  - backslash path variants
  - `\0`
  - `/@id/`
  - `commonjs-external:`
  - `commonjs-proxy:`
  - query/hash suffixes
- treat any normalized `.node` path as external
- treat any normalized resolved `node_modules/...` path as external
- keep explicit bare-ID/subpath externalization for:
  - `ssh2-sftp-client`
  - `ssh2`
  - `cpu-features`
  - all runtime `package.json` dependencies
- keep top-level and nested `resolve.preserveSymlinks=true`

Why this is the smallest safe fix:

- it changes only Electron/Vite build behavior
- it does not touch product logic or remote-service behavior
- it ensures Rollup never opens `cpu-features/lib/index.js` or any `.node` payload under resolved `node_modules/...` paths

## Native Dependency Externalization Status

Current repo config externalizes all required native/runtime surfaces for Electron main/preload:

- `ssh2-sftp-client`
- `ssh2`
- `cpu-features`
- dependency bare IDs and subpaths
- resolved `node_modules/...` paths
- normalized `.node` native addon paths

## Required Gate Results

### `npm run build`

Result: **FAIL**

Observed blocker after the latest fix:

- build now reaches the nested Electron close-bundle build
- `vite:esbuild` fails while transforming `electron/main.ts`
- exact error: `spawn EPERM`

Output status:

- `dist-electron/main.js`: **not produced**
- `dist-electron/preload.js`: **not produced**

### `npm run verify`

Result: **FAIL**

Reason:

- it fails at the same `npm run build` Electron `vite:esbuild` `spawn EPERM`

### `npm run smoke:packaged`

Result: **FAIL**

Reason:

- smoke clears `release/`
- smoke fails at the build step with `spawn EPERM`

### `npx electron-builder -- --win nsis --publish never --config.win.signAndEditExecutable=false`

Result: **FAIL**

Reason:

- `electron-builder` still fails launching `app-builder.exe` with `spawn EPERM`

## Final Status

Are `dist-electron/main.js` and `dist-electron/preload.js` produced in this shell?

**No.**

Exact reason `cpufeatures.node` was still entering Rollup:

**The external matcher was evaluating decorated CommonJS/Vite IDs, not always a clean `../build/Release/cpufeatures.node` string, so the previous literal `.node` check could still miss the native addon path and let Rollup continue resolving it.**

Exact config fix that stopped it:

**Normalize the Electron external matcher input first, then externalize any normalized `.node` path plus any resolved `node_modules/...` path. That prevents Rollup from descending into `cpu-features` and its native addon loader at all.**

Are all build/package gates finally green in this shell?

**No.**

Reason:

- the remaining blockers in this shell are environment-level Windows child-process `EPERM` failures during:
  - Electron `vite:esbuild` transform of `electron/main.ts`
  - `electron-builder` launch of `app-builder.exe`

Is Phase 5.2 safe to start?

**No.**
