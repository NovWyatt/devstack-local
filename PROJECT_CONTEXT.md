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
- Phase 5.1.1 stabilization investigation is complete:
  - stale tracked Phase 5 temp/cache artifacts were identified and ignore coverage was added
  - the current machine blocks Node/Electron child-process creation with `spawn EPERM`
  - the blocker affects Vite/esbuild, `tsx`, real Apache/MySQL/PHP-CGI start tests, and `electron-builder`
- Previous stable phases remain preserved in code, but repo-wide `npm run verify` and `npm run smoke:packaged` cannot pass on this specific machine until the Windows Node/Electron child-process `EPERM` issue is resolved.
- This session also cannot write into `.git`, so tracked temp/cache artifact cleanup and commit operations remain blocked until the repo ACL issue is cleared.
