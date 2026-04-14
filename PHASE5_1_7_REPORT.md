# Phase 5.1.7 Report - Final Electron Build Externalization Fix

**Project:** DevStack Local  
**Phase:** 5.1.7  
**Date:** 2026-04-14

## Scope

This pass stayed inside the Electron build pipeline only.

Explicitly not done:

- no Phase 5.2 work
- no product features
- no UI redesign
- no speculative refactors outside build/config scope

## Exact Reason `cpufeatures.node` Was Still Entering Rollup

The Phase 5.1.6 externalization rule was still too narrow.

It only matched:

- direct app dependencies from the root `package.json`
- bare package IDs such as `ssh2-sftp-client`
- bare package subpaths such as `ssh2-sftp-client/...`

It did **not** match:

- transitive runtime package IDs such as `ssh2`
- transitive optional native package IDs such as `cpu-features`
- resolved `node_modules` file paths such as:
  - `.../node_modules/ssh2/lib/protocol/constants.js`
  - `.../node_modules/cpu-features/lib/index.js`
- native addon file IDs such as:
  - `./build/Release/cpufeatures.node`
  - `.../node_modules/cpu-features/build/Release/cpufeatures.node`

Why that matters:

- `electron/services/remote.service.ts` imports `ssh2-sftp-client`
- `ssh2-sftp-client` depends on `ssh2`
- `ssh2/lib/protocol/constants.js` does an optional `require('cpu-features')()`
- `cpu-features/lib/index.js` loads `../build/Release/cpufeatures.node`

So if Rollup/Vite resolves past the original bare `ssh2-sftp-client` import and starts operating on resolved/transitive IDs, the old rule no longer externalized them. That is why `cpufeatures.node` could still enter the bundle graph.

Direct validation from this session:

- old rule externalized `ssh2-sftp-client`
- old rule did **not** externalize:
  - `ssh2`
  - `cpu-features`
  - resolved `node_modules/ssh2/...`
  - resolved `node_modules/cpu-features/...`
  - `cpufeatures.node`

## Exact Config Fix That Stopped It

Updated files:

- `vite.config.ts`
- `package.json`

Exact fix in `vite.config.ts`:

- switched config path resolution from `__dirname` to `fileURLToPath(import.meta.url)` so the config can be loaded directly as ESM
- expanded the Electron externalization rule to explicitly externalize:
  - `ssh2-sftp-client`
  - `ssh2`
  - `cpu-features`
  - all direct runtime dependencies from `package.json`
- broadened matching so Electron builds now externalize:
  - bare package IDs
  - package subpaths
  - resolved `node_modules/<package>/...` paths
  - any `.node` native addon path
- added `resolve.preserveSymlinks=true` to the nested Electron build configs to avoid Vite's Windows safe-realpath shell probe during Electron close-bundle resolution

Exact fix in `package.json`:

- changed `npm run build` to call the Vite JavaScript API with `configFile: false`
- this bypasses the CLI TypeScript config-loader path and loads `vite.config.ts` directly through `node --experimental-strip-types`

Why this is the smallest safe fix:

- it changes only build/config behavior
- it does not change remote-service runtime logic
- it does not remove `ssh2-sftp-client`
- it does not widen scope beyond Electron build/package gates

## Required Command Results In This Session

### `npm run build`

Result: **FAIL**

Current blocker in this shell:

- Electron close-bundle now starts through the direct Vite API path
- the next failure is `vite:esbuild` on `electron/main.ts`
- exact error: `spawn EPERM`

Output status after the failed build:

- `dist-electron/main.js`: not produced
- `dist-electron/preload.js`: not produced

### `npm run verify`

Result: **FAIL**

Reason:

- it fails at `npm run build` with the same Electron `vite:esbuild` `spawn EPERM`

### `npm run smoke:packaged`

Result: **FAIL**

Reason:

- smoke cleans `release/`
- smoke fails at the build step with `spawn EPERM`

### `npx electron-builder -- --win nsis --publish never --config.win.signAndEditExecutable=false`

Result: **FAIL**

Reason:

- `electron-builder` still fails launching `app-builder.exe` with `spawn EPERM`

## Final Status

Exact reason `cpufeatures.node` was still entering Rollup:

- the previous rule only externalized direct/bare dependency IDs and missed transitive, resolved `node_modules` paths and `.node` native addon IDs

Exact config fix that stopped it:

- Electron build externalization now explicitly covers `ssh2-sftp-client`, `ssh2`, `cpu-features`, resolved `node_modules` paths for those packages, and any `.node` file ID

Are all build/package gates finally green in this shell?

**No.**

Can Phase 5.2 start?

**No.**

Reason:

- the `cpufeatures.node` externalization gap is fixed in repo config
- this shell still blocks Electron build/package execution at the environment level with Windows `spawn EPERM`
