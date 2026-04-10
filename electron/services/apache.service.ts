/**
 * Apache Service Manager — Real Implementation
 *
 * Manages the Apache HTTP Server (httpd.exe) lifecycle on Windows.
 * Uses child_process.spawn for process management and tree-kill
 * for reliable process tree cleanup.
 *
 * Features:
 * - Real process spawning via ProcessManager
 * - Port conflict detection before start
 * - stdout/stderr log streaming to UI
 * - Restart support (stop → start)
 * - Graceful and forced shutdown
 */

import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { ServiceState } from '../../src/types';
import { isPortAvailable, getPortConflictMessage } from '../utils/port.util';
import { ConfigStore } from '../utils/config.store';

// Forward reference — ProcessManager is passed via constructor to avoid circular imports
import type { ProcessManager } from './process.manager';

/** Callback type for emitting log messages */
type LogEmitter = (level: string, message: string) => void;

/** Process name used in the ProcessManager map */
const PROCESS_NAME = 'apache';

export class ApacheService {
  private status: 'running' | 'stopped' | 'starting' | 'stopping' = 'stopped';
  private version: string = '2.4.62';
  private port: number = 80;
  private pid: number | undefined;
  private processManager: ProcessManager;
  private logEmitter: LogEmitter | null = null;

  constructor(pm: ProcessManager) {
    this.processManager = pm;
    // Restore saved port from config
    this.port = ConfigStore.getPort('apache');
  }

  /** Register a log emitter callback */
  setLogEmitter(emitter: LogEmitter): void {
    this.logEmitter = emitter;
  }

  /**
   * Start the Apache HTTP Server.
   *
   * 1. Checks if already running
   * 2. Resolves binary path
   * 3. Checks port availability
   * 4. Spawns httpd.exe
   * 5. Waits for successful startup
   */
  async start(version?: string, port?: number): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') {
      throw new Error('Apache is already running');
    }

    this.status = 'starting';

    if (version) this.version = version;
    if (port) {
      this.port = port;
      ConfigStore.setPort('apache', port);
    }

    this.emitLog('system', 'Starting Apache Web Server...');

    // ── Resolve binary path ──────────────────────────────────────
    const binaryPath = this.resolveBinaryPath();
    if (!binaryPath) {
      this.status = 'stopped';
      throw new Error(
        'Apache binary (httpd.exe) not found. Place Apache binaries in resources/binaries/apache/ or configure the path in settings.'
      );
    }

    this.emitLog('system', `Binary: ${binaryPath}`);

    // ── Check port availability ──────────────────────────────────
    const portAvailable = await isPortAvailable(this.port);
    if (!portAvailable) {
      this.status = 'stopped';
      const msg = getPortConflictMessage(this.port, 'Apache');
      this.emitLog('error', msg);
      throw new Error(msg);
    }

    this.emitLog('system', `Port ${this.port} is available`);

    // ── Build config path ────────────────────────────────────────
    const apacheDir = path.dirname(path.dirname(binaryPath)); // go up from bin/httpd.exe
    const confPath = path.join(apacheDir, 'conf', 'httpd.conf');

    // Check if config exists
    if (!fs.existsSync(confPath)) {
      this.emitLog('warning', `Config not found at ${confPath}, using default args`);
    }

    // ── Spawn the process ────────────────────────────────────────
    const args: string[] = [];
    if (fs.existsSync(confPath)) {
      args.push('-f', confPath);
    }
    // Add port override via command line
    args.push('-c', `Listen ${this.port}`);

    try {
      const child = this.processManager.startProcess(
        PROCESS_NAME,
        binaryPath,
        args,
        {
          cwd: apacheDir,
          windowsHide: true,
        }
      );

      this.pid = child.pid;

      // Wait a moment for startup, then verify the process is still alive
      await new Promise((resolve) => setTimeout(resolve, 1500));

      if (this.processManager.isRunning(PROCESS_NAME)) {
        this.status = 'running';
        this.pid = this.processManager.getProcessPid(PROCESS_NAME);
        this.emitLog('success', `Apache started successfully (PID: ${this.pid})`);
        this.emitLog('success', `Listening on port ${this.port}`);
      } else {
        this.status = 'stopped';
        this.pid = undefined;
        throw new Error('Apache process exited immediately after starting. Check the error log.');
      }
    } catch (error) {
      this.status = 'stopped';
      this.pid = undefined;
      if (error instanceof Error && error.message.includes('exited immediately')) {
        throw error;
      }
      throw new Error(`Failed to spawn Apache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Stop the Apache HTTP Server.
   * Uses tree-kill via ProcessManager for full process tree cleanup.
   */
  async stop(): Promise<void> {
    if (this.status === 'stopped') {
      throw new Error('Apache is not running');
    }

    this.status = 'stopping';
    this.emitLog('system', 'Stopping Apache Web Server...');

    const previousPid = this.pid;

    try {
      await this.processManager.stopProcess(PROCESS_NAME, 5000);
      this.status = 'stopped';
      this.pid = undefined;
      this.emitLog('success', `Apache stopped (PID: ${previousPid})`);
    } catch (error) {
      // Force status to stopped even if kill had issues
      this.status = 'stopped';
      this.pid = undefined;
      this.emitLog('warning', `Apache stop had issues but process should be dead: ${error}`);
    }
  }

  /**
   * Restart the Apache HTTP Server.
   */
  async restart(): Promise<void> {
    this.emitLog('system', 'Restarting Apache...');
    if (this.status === 'running') {
      await this.stop();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await this.start();
  }

  /**
   * Get the current status of the Apache service.
   */
  getStatus(): ServiceState {
    // Validate PID is still alive if we think we're running
    if (this.status === 'running' && !this.processManager.isRunning(PROCESS_NAME)) {
      this.status = 'stopped';
      this.pid = undefined;
    }

    return {
      status: this.status,
      version: this.version,
      port: this.port,
      pid: this.status === 'running' ? this.pid : undefined,
    };
  }

  // ─── Internal Helpers ─────────────────────────────────────────────

  /**
   * Resolve the httpd.exe binary path.
   * Checks:
   * 1. ConfigStore saved path
   * 2. resources/binaries/apache/bin/httpd.exe
   * 3. Common Windows Apache locations
   */
  private resolveBinaryPath(): string | null {
    // Check ConfigStore first
    const savedPath = ConfigStore.getBinaryPath('apache');
    if (savedPath) {
      const exe = path.join(savedPath, 'bin', 'httpd.exe');
      if (fs.existsSync(exe)) return exe;
    }

    // Check project resources directory
    const resourcePaths = [
      path.join(app.getAppPath(), 'resources', 'binaries', 'apache', 'bin', 'httpd.exe'),
      path.join(process.cwd(), 'resources', 'binaries', 'apache', 'bin', 'httpd.exe'),
    ];

    for (const p of resourcePaths) {
      if (fs.existsSync(p)) return p;
    }

    // Check common Windows locations
    const commonPaths = [
      'C:\\Apache24\\bin\\httpd.exe',
      'C:\\Apache\\bin\\httpd.exe',
      'C:\\devstack\\apache\\bin\\httpd.exe',
    ];

    for (const p of commonPaths) {
      if (fs.existsSync(p)) return p;
    }

    return null;
  }

  /** Emit a log message */
  private emitLog(level: string, message: string): void {
    // Route through process manager's log system for batching
    this.processManager.broadcastLog(level, message);

    // Also call local emitter if set
    if (this.logEmitter) {
      this.logEmitter(level, message);
    }
  }
}
