/**
 * MySQL Service Manager — Real Implementation
 *
 * Manages the MySQL Server (mysqld.exe) lifecycle on Windows.
 * Handles data directory initialization, port conflicts,
 * graceful shutdown via mysqladmin, and fallback force-kill.
 *
 * Features:
 * - Real process spawning via ProcessManager
 * - Auto data directory initialization (--initialize-insecure)
 * - Port conflict detection
 * - Graceful shutdown via mysqladmin
 * - Fallback to tree-kill if mysqladmin fails
 * - stderr log streaming (MySQL logs to stderr)
 */

import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { app } from 'electron';
import type { ServiceState } from '../../src/types';
import { isPortAvailable, getPortConflictMessage } from '../utils/port.util';
import { ConfigStore } from '../utils/config.store';

import type { ProcessManager } from './process.manager';

/** Callback type for emitting log messages */
type LogEmitter = (level: string, message: string) => void;

const PROCESS_NAME = 'mysql';

export class MySQLService {
  private status: 'running' | 'stopped' | 'starting' | 'stopping' = 'stopped';
  private version: string = '8.0';
  private port: number = 3306;
  private pid: number | undefined;
  private processManager: ProcessManager;
  private logEmitter: LogEmitter | null = null;
  private mysqldPath: string | null = null;

  constructor(pm: ProcessManager) {
    this.processManager = pm;
    this.port = ConfigStore.getPort('mysql');
  }

  setLogEmitter(emitter: LogEmitter): void {
    this.logEmitter = emitter;
  }

  /**
   * Start the MySQL Server.
   *
   * 1. Checks if already running
   * 2. Resolves binary path
   * 3. Initializes data directory if missing
   * 4. Checks port availability
   * 5. Spawns mysqld.exe
   * 6. Waits for successful startup
   */
  async start(version?: string, port?: number): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') {
      throw new Error('MySQL is already running');
    }

    this.status = 'starting';

    if (version) this.version = version;
    if (port) {
      this.port = port;
      ConfigStore.setPort('mysql', port);
    }

    this.emitLog('system', 'Starting MySQL Database Server...');

    // ── Resolve binary path ──────────────────────────────────────
    this.mysqldPath = this.resolveBinaryPath();
    if (!this.mysqldPath) {
      this.status = 'stopped';
      throw new Error(
        'MySQL binary (mysqld.exe) not found. Place MySQL binaries in resources/binaries/mysql/ or configure the path in settings.'
      );
    }

    this.emitLog('system', `Binary: ${this.mysqldPath}`);

    const mysqlBaseDir = path.dirname(path.dirname(this.mysqldPath)); // up from bin/mysqld.exe
    const dataDir = path.join(mysqlBaseDir, 'data');

    // ── Initialize data directory if missing ─────────────────────
    if (!fs.existsSync(dataDir) || this.isDataDirEmpty(dataDir)) {
      this.emitLog('system', 'Data directory missing or empty, initializing...');
      await this.initializeDataDir(this.mysqldPath, dataDir, mysqlBaseDir);
    }

    // ── Check port availability ──────────────────────────────────
    const portAvailable = await isPortAvailable(this.port);
    if (!portAvailable) {
      this.status = 'stopped';
      const msg = getPortConflictMessage(this.port, 'MySQL');
      this.emitLog('error', msg);
      throw new Error(msg);
    }

    this.emitLog('system', `Port ${this.port} is available`);

    // ── Build args ───────────────────────────────────────────────
    const args: string[] = [
      `--basedir=${mysqlBaseDir}`,
      `--datadir=${dataDir}`,
      `--port=${this.port}`,
      '--console', // Log to stderr instead of file
    ];

    // Check for my.ini / my.cnf
    const configPaths = [
      path.join(mysqlBaseDir, 'my.ini'),
      path.join(mysqlBaseDir, 'my.cnf'),
    ];
    for (const cfgPath of configPaths) {
      if (fs.existsSync(cfgPath)) {
        args.unshift(`--defaults-file=${cfgPath}`);
        this.emitLog('system', `Using config: ${cfgPath}`);
        break;
      }
    }

    // ── Spawn the process ────────────────────────────────────────
    try {
      const child = this.processManager.startProcess(
        PROCESS_NAME,
        this.mysqldPath,
        args,
        {
          cwd: mysqlBaseDir,
          windowsHide: true,
        }
      );

      this.pid = child.pid;

      // MySQL takes longer to start — wait 3 seconds then verify
      this.emitLog('system', 'Waiting for MySQL to initialize...');
      await new Promise((resolve) => setTimeout(resolve, 3000));

      if (this.processManager.isRunning(PROCESS_NAME)) {
        this.status = 'running';
        this.pid = this.processManager.getProcessPid(PROCESS_NAME);
        this.emitLog('success', `MySQL started successfully (PID: ${this.pid})`);
        this.emitLog('success', `Accepting connections on port ${this.port}`);
      } else {
        this.status = 'stopped';
        this.pid = undefined;
        throw new Error('MySQL process exited immediately. Check the error log for details.');
      }
    } catch (error) {
      this.status = 'stopped';
      this.pid = undefined;
      if (error instanceof Error && error.message.includes('exited immediately')) {
        throw error;
      }
      throw new Error(`Failed to spawn MySQL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Stop the MySQL Server.
   *
   * Attempts graceful shutdown via mysqladmin first.
   * Falls back to tree-kill if mysqladmin fails or times out.
   */
  async stop(): Promise<void> {
    if (this.status === 'stopped') {
      throw new Error('MySQL is not running');
    }

    this.status = 'stopping';
    this.emitLog('system', 'Stopping MySQL Database Server...');

    const previousPid = this.pid;

    // Try graceful shutdown via mysqladmin
    const graceful = await this.gracefulShutdown();

    if (!graceful) {
      this.emitLog('warning', 'Graceful shutdown failed, using force kill...');
      await this.processManager.stopProcess(PROCESS_NAME, 5000);
    }

    this.status = 'stopped';
    this.pid = undefined;
    this.emitLog('success', `MySQL stopped (PID: ${previousPid})`);
  }

  /**
   * Restart MySQL.
   */
  async restart(): Promise<void> {
    this.emitLog('system', 'Restarting MySQL...');
    if (this.status === 'running') {
      await this.stop();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await this.start();
  }

  /**
   * Get the current status.
   */
  getStatus(): ServiceState {
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
   * Attempt graceful shutdown using mysqladmin.
   * Returns true if successful, false if failed.
   */
  private async gracefulShutdown(): Promise<boolean> {
    const mysqladminPath = this.mysqldPath
      ? path.join(path.dirname(this.mysqldPath), 'mysqladmin.exe')
      : null;

    if (!mysqladminPath || !fs.existsSync(mysqladminPath)) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);

      execFile(
        mysqladminPath,
        ['--port', String(this.port), '-u', 'root', 'shutdown'],
        { windowsHide: true },
        (error) => {
          clearTimeout(timeout);
          if (error) {
            this.emitLog('warning', `mysqladmin shutdown failed: ${error.message}`);
            resolve(false);
          } else {
            this.emitLog('system', 'MySQL shutdown via mysqladmin successful');
            // Wait for process to fully exit
            setTimeout(() => resolve(true), 1000);
          }
        }
      );
    });
  }

  /**
   * Initialize the MySQL data directory for first-time setup.
   */
  private async initializeDataDir(
    mysqldPath: string,
    dataDir: string,
    baseDir: string
  ): Promise<void> {
    // Create data directory if it doesn't exist
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    return new Promise<void>((resolve, reject) => {
      this.emitLog('system', 'Running mysqld --initialize-insecure...');

      execFile(
        mysqldPath,
        [
          `--basedir=${baseDir}`,
          `--datadir=${dataDir}`,
          '--initialize-insecure',
        ],
        { windowsHide: true, timeout: 30000 },
        (error, _stdout, stderr) => {
          if (error) {
            this.emitLog('error', `MySQL initialization failed: ${error.message}`);
            reject(new Error(`MySQL data initialization failed: ${error.message}`));
          } else {
            if (stderr) {
              this.emitLog('system', `MySQL init: ${stderr.substring(0, 200)}`);
            }
            this.emitLog('success', 'MySQL data directory initialized');
            resolve();
          }
        }
      );
    });
  }

  /** Check if data directory is empty (no mysql system db) */
  private isDataDirEmpty(dataDir: string): boolean {
    try {
      const entries = fs.readdirSync(dataDir);
      // A valid MySQL data dir should have a 'mysql' subdirectory
      return !entries.includes('mysql');
    } catch {
      return true;
    }
  }

  /**
   * Resolve the mysqld.exe binary path.
   */
  private resolveBinaryPath(): string | null {
    const savedPath = ConfigStore.getBinaryPath('mysql');
    if (savedPath) {
      const exe = path.join(savedPath, 'bin', 'mysqld.exe');
      if (fs.existsSync(exe)) return exe;
    }

    const resourcePaths = [
      path.join(app.getAppPath(), 'resources', 'binaries', 'mysql', 'bin', 'mysqld.exe'),
      path.join(process.cwd(), 'resources', 'binaries', 'mysql', 'bin', 'mysqld.exe'),
    ];

    for (const p of resourcePaths) {
      if (fs.existsSync(p)) return p;
    }

    const commonPaths = [
      'C:\\MySQL\\bin\\mysqld.exe',
      'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe',
      'C:\\devstack\\mysql\\bin\\mysqld.exe',
    ];

    for (const p of commonPaths) {
      if (fs.existsSync(p)) return p;
    }

    return null;
  }

  private emitLog(level: string, message: string): void {
    this.processManager.broadcastLog(level, message);
    if (this.logEmitter) {
      this.logEmitter(level, message);
    }
  }
}
