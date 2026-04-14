# Project Context

## Overview
- **Purpose:** Windows desktop app for managing a local PHP/Apache/MySQL dev stack with safe operational tooling.
- **Tech Stack:** Electron 28, React 18, TypeScript 5, Vite 5, TailwindCSS 3, Zustand 4, electron-store, ssh2-sftp-client, basic-ftp.
- **Architecture:** Electron main-process service layer with typed preload IPC bridge and React/Zustand renderer pages.

## Features
- Dashboard with service controls, logs, and diagnostics.
- PHP manager with version activation, ini editing, extensions, and downloads.
- Domains manager with hosts/vhost orchestration and Apache validation.
- Database manager with browser, schema/rows view, SQL console, import/export, and CSV export.
- Packaging and installer validation with packaged smoke checks.
- SSH / FTP manager foundation with saved connections, test/connect/disconnect, and remote root preview.

## Current Status
- Phases 1 through 4.5 are complete and verified.
- Phase 5.1 implementation is complete in code:
  - SFTP-first remote manager page replaces the placeholder route.
  - Saved connection CRUD, status indicators, test connection, connect/disconnect, and root preview are implemented.
  - Sensitive remote passwords are isolated from non-sensitive metadata and stored through OS-backed encryption when Electron secure storage is available.
  - No shell access, background sync, auto-upload, tunneling, or Phase 5.2 work has been added.
- Phase 5.1 service-level tests pass locally via direct Node type-stripping execution.
- Phase 5.1.2 packaging/runtime unblock is implemented in code:
  - `electron-builder` now skips optional native dependency rebuilds (`npmRebuild=false`), avoiding the unnecessary `ssh2 -> cpu-features@0.0.10` rebuild path
  - Electron main-process packaged path resolution now uses ESM-safe `fileURLToPath(import.meta.url)` instead of raw `__dirname`
  - packaged smoke now clears `release/` before running and stops immediately on the first build/package failure
- Phase 5.1.3 packaging/runtime fix is implemented in code:
  - the standard build pipeline now runs Vite in `electron` mode so Electron main/preload are rebuilt for packaging gates
  - packaged smoke now rejects stale `dist-electron` output that still contains `__dirname` or `__filename`
- Phase 5.1.6 native Electron bundling fix is implemented in code:
  - Electron main/preload builds now externalize runtime `package.json` dependencies instead of bundling them into `dist-electron`
  - this keeps `ssh2-sftp-client`, `ssh2`, and the optional native `cpu-features` addon out of the Rollup bundle graph
- Phase 5.1.7 Electron build-pipeline hardening is implemented in code:
  - Electron externalization now also matches transitive/resolved `node_modules` paths and `.node` native addon IDs, closing the remaining `cpufeatures.node` Rollup gap
  - `npm run build` now uses the Vite JavaScript API with `configFile=false` so the build does not depend on the CLI TypeScript config-loader path
  - nested Electron builds now use `resolve.preserveSymlinks=true` to avoid Vite's Windows safe-realpath shell probe during Electron close-bundle resolution
- Phase 5.1.8 build-closure hardening is implemented in code:
  - Electron externalization now normalizes Vite/Rollup CommonJS-decorated IDs before matching, including `\0`, `/@id/`, `commonjs-external:`, `commonjs-proxy`, and query/hash suffixes
  - any resolved `node_modules/...` path and any normalized `.node` addon path is kept external in Electron main/preload builds, so Rollup does not descend into `cpu-features/lib/index.js`
  - the top-level Vite config also uses `resolve.preserveSymlinks=true`, keeping the renderer-side build path off Vite's Windows safe-realpath shell probe
- Previous stable phases remain preserved in code, but the required packaging gates still cannot pass on this specific machine because Node child-process creation is blocked at the environment level:
  - `npm run build` now reaches the Electron close-bundle path here, but still fails when `vite:esbuild` tries to transform `electron/main.ts`
  - `npm run verify` fails at that same Electron build step
  - `npm run smoke:packaged` fails at its build step for the same reason
  - `npx electron-builder -- --win nsis --publish never --config.win.signAndEditExecutable=false` fails when Node tries to launch `app-builder.exe`
  - direct probes under both the PATH Node runtime and the pinned local Node 22 runtime show `spawn EPERM` even for `cmd.exe`
  - the latest exact rerun of all four required commands in this session reconfirmed the same environment-level failure and still did not produce `dist-electron/main.js`, `dist-electron/preload.js`, or a packaged `win-unpacked` executable
  - Phase 5.2 is still not safe to start
