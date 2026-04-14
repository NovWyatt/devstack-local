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
- Previous stable phases remain preserved in code, but the required packaging gates still cannot pass on this specific machine because Windows is returning `spawn EPERM` for Vite/esbuild and `app-builder.exe`.
