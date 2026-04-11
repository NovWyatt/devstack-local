# Phase 2.6 Report - System Hardening

**Project:** DevStack Local  
**Phase:** 2.6 (Stability Hardening)  
**Date:** 2026-04-11

## 1. Scope
Phase 2.6 was implemented as hardening-only work:
- No UI changes
- No mock fallback reintroduced
- TypeScript strict build preserved
- Focused on crash safety, validation, monitoring, and shutdown reliability

## 2. Bugs Fixed
1. **Crash loop protection**
- Added max restart attempts (`3`) with exponential backoff (`1000ms`, `2000ms`, `5000ms`)
- Auto-restart now stops after the third failed restart cycle
- Emits service error when restart limit is exceeded

2. **Binary validation before spawn**
- Added executable validation (`exists`, `is file`, `executable/access checks`) before any `spawn`
- Added validation before MySQL `execFile` paths (`mysqld --initialize-insecure`, `mysqladmin shutdown`)

3. **Runtime validation after service start**
- Apache: validates `http://localhost:{port}` response
- MySQL: validates TCP listener on configured port
- PHP-CGI: validates listener on resolved FastCGI port
- On validation failure: process is stopped, service marked failed, error emitted

4. **Removed fixed startup delays**
- Replaced hardcoded startup waits with retry-based readiness checks (`max 5 attempts`, short delay)
- Removed restart-path fixed delays from service/process restart operations

5. **Health monitoring loop**
- Added 5-second health loop in `ProcessManager`
- Checks process liveness and configured health port
- On health failure: marks crashed and routes through bounded auto-restart logic

6. **PHP port logic fix**
- Port formula updated from `9000 + major*10 + minor` to `9000 + major*100 + minor`
- If preferred port is busy, it resolves the next available port automatically

7. **MySQL initialization safety**
- `--initialize-insecure` now runs only when data directory does not exist
- Existing data directory explicitly skips init path

8. **Log system protection**
- Kept 100ms batching
- Added max in-memory log buffer (`1000` entries)
- Oldest log entries are dropped on overflow

9. **ProcessManager hardening**
- Duplicate process starts are blocked
- Restart attempts tracked and bounded
- Stop flow waits for real PID exit, escalates to force-kill when needed
- Shutdown flow clears health/restart timers and prevents restart churn during stop-all

## 3. Systems Added
- `electron/utils/binary.util.ts`
  - `assertExecutable(...)` for path/executable validation
- `electron/utils/retry.util.ts`
  - retry/sleep primitives used by service runtime checks
- `electron/utils/runtime.validation.ts`
  - HTTP responsiveness probe for Apache runtime validation
- `electron/utils/port.util.ts` (extended)
  - added `isPortListening(...)` for runtime and health checks
- `scripts/phase2_6_real_tests.ts`
  - real integration runner using actual binaries under `resources/binaries/`

## 4. Real Test Results (Not Simulated)
Test command executed:
```bash
npx tsx scripts/phase2_6_real_tests.ts
```

Artifacts:
- `phase2_6_test_results.json` (raw results)

Results:
1. **Apache starts and responds on localhost** - PASS  
   `PID 9240, HTTP probe succeeded on http://localhost:80`
2. **MySQL starts and accepts TCP connections** - PASS  
   `PID 19980, TCP probe succeeded on 127.0.0.1:3306`
3. **PHP-CGI starts and listens on runtime port** - PASS  
   `PID 6628, TCP probe succeeded on 127.0.0.1:9803`
4. **Crash auto-restart enforces max 3 attempts** - PASS  
   `Observed 3 restarts with unique PIDs: 18128, 9424, 10716`
5. **Stop services leaves no managed processes running** - PASS  
   All tracked service processes stopped; original PIDs were no longer alive
6. **Port conflict returns clear MySQL error** - PASS  
   Error contained explicit `Port 3306 is already in use...`
7. **Missing binary returns clear Apache error** - PASS  
   Error contained explicit Apache binary not found message

Build verification:
```bash
npm run build
```
- PASS (`tsc` + `vite build`, no TypeScript errors)

## 5. Stability Improvements
- Startup now depends on real readiness checks, not timing assumptions
- Crash recovery behavior is bounded and deterministic
- Health degradation is detected continuously during runtime
- Stop/shutdown behavior no longer leaves restart timers active
- Log pressure is bounded to prevent unbounded memory growth

## 6. File Changes
- `electron/services/process.manager.ts`
- `electron/services/apache.service.ts`
- `electron/services/mysql.service.ts`
- `electron/services/php.service.ts`
- `electron/utils/port.util.ts`
- `electron/main.ts`
- `electron/utils/retry.util.ts` (new)
- `electron/utils/binary.util.ts` (new)
- `electron/utils/runtime.validation.ts` (new)
- `scripts/phase2_6_real_tests.ts` (new)

## 7. Ready for Phase 3?
**Yes.**

Reason:
- All Phase 2.6 hardening requirements were implemented
- Required real runtime tests passed against actual binaries
- Strict TypeScript build remains clean
