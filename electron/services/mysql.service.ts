/**
 * MySQL service lifecycle manager.
 */

import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import type { ServiceState } from '../../src/types';
import { assertExecutable } from '../utils/binary.util';
import { ConfigStore } from '../utils/config.store';
import { getPortConflictMessage, isPortAvailable, isPortListening } from '../utils/port.util';
import { retryCheck, retryOrThrow } from '../utils/retry.util';
import { ensureDir, getBundledBinaryRoots, getMySQLDataDir, getMySQLTmpDir } from '../utils/runtime.paths';
import type { ProcessManager } from './process.manager';

type LogEmitter = (level: string, message: string) => void;

const PROCESS_NAME = 'mysql';
const STARTUP_RETRY_ATTEMPTS = 5;
const STARTUP_RETRY_DELAY_MS = 500;

export class MySQLService {
  private status: 'running' | 'stopped' | 'starting' | 'stopping' = 'stopped';
  private version = '8.0';
  private port = 3306;
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

    this.mysqldPath = this.resolveBinaryPath();
    if (!this.mysqldPath) {
      this.status = 'stopped';
      throw new Error(
        'MySQL binary (mysqld.exe) not found. Place MySQL binaries in resources/binaries/mysql/ or configure the path in settings.'
      );
    }

    assertExecutable(this.mysqldPath, 'MySQL');
    this.emitLog('system', `Binary: ${this.mysqldPath}`);

    const mysqlBaseDir = path.dirname(path.dirname(this.mysqldPath));
    const dataDir = getMySQLDataDir();
    const tmpDir = ensureDir(getMySQLTmpDir());

    // Safety: only initialize when directory does not exist.
    if (!fs.existsSync(dataDir)) {
      this.emitLog('system', 'Data directory not found, initializing...');
      await this.initializeDataDir(this.mysqldPath, dataDir, mysqlBaseDir);
    } else {
      this.emitLog('system', `Data directory exists, skipping initialization: ${dataDir}`);
    }

    const portAvailable = await isPortAvailable(this.port);
    if (!portAvailable) {
      this.status = 'stopped';
      const message = getPortConflictMessage(this.port, 'MySQL');
      this.emitLog('error', message);
      throw new Error(message);
    }

    const args: string[] = [
      `--basedir=${mysqlBaseDir}`,
      `--datadir=${dataDir}`,
      `--tmpdir=${tmpDir}`,
      `--port=${this.port}`,
      '--console',
    ];

    const configPaths = [path.join(mysqlBaseDir, 'my.ini'), path.join(mysqlBaseDir, 'my.cnf')];
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        args.unshift(`--defaults-file=${configPath}`);
        this.emitLog('system', `Using config: ${configPath}`);
        break;
      }
    }

    try {
      const child = this.processManager.startProcess(
        PROCESS_NAME,
        this.mysqldPath,
        args,
        {
          cwd: mysqlBaseDir,
          windowsHide: true,
        },
        true,
        { port: this.port, host: '127.0.0.1' }
      );

      this.pid = child.pid;

      await retryOrThrow(
        async () => {
          if (!this.processManager.isRunning(PROCESS_NAME)) {
            return false;
          }
          return isPortListening(this.port, '127.0.0.1', 1000);
        },
        {
          attempts: STARTUP_RETRY_ATTEMPTS,
          delayMs: STARTUP_RETRY_DELAY_MS,
        },
        `MySQL failed runtime validation on 127.0.0.1:${this.port}`
      );

      this.status = 'running';
      this.pid = this.processManager.getProcessPid(PROCESS_NAME);
      this.processManager.resetRestartAttempts(PROCESS_NAME);
      this.emitLog('success', `MySQL started successfully (PID: ${this.pid})`);
      this.emitLog('success', `MySQL accepts TCP connections on port ${this.port}`);
    } catch (error) {
      if (this.processManager.isRunning(PROCESS_NAME)) {
        await this.processManager.stopProcess(PROCESS_NAME);
      }
      this.status = 'stopped';
      this.pid = undefined;

      const message = error instanceof Error ? error.message : String(error);
      this.emitLog('error', `MySQL startup failed: ${message}`);
      throw new Error(message);
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'stopped') {
      throw new Error('MySQL is not running');
    }

    this.status = 'stopping';
    this.emitLog('system', 'Stopping MySQL Database Server...');

    const previousPid = this.pid;
    this.processManager.markProcessIntentionalStop(PROCESS_NAME);
    const graceful = await this.gracefulShutdown();

    if (!graceful) {
      this.emitLog('warning', 'Graceful shutdown failed, forcing process stop...');
    }

    // Always finalize via ProcessManager so restart timers are cleared and
    // tracking state is removed even when mysqladmin already exited mysqld.
    await this.processManager.stopProcess(PROCESS_NAME, graceful ? 2000 : 5000);

    this.status = 'stopped';
    this.pid = undefined;
    this.emitLog('success', `MySQL stopped (PID: ${previousPid ?? 'unknown'})`);
  }

  async restart(): Promise<void> {
    this.emitLog('system', 'Restarting MySQL...');
    if (this.status === 'running') {
      await this.stop();
    }
    await this.start();
  }

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

  private async gracefulShutdown(): Promise<boolean> {
    if (!this.mysqldPath) {
      return false;
    }

    const mysqladminPath = path.join(path.dirname(this.mysqldPath), 'mysqladmin.exe');
    try {
      assertExecutable(mysqladminPath, 'MySQL admin');
    } catch (error) {
      this.emitLog(
        'warning',
        `mysqladmin unavailable for graceful shutdown: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }

    const commandSucceeded = await new Promise<boolean>((resolve) => {
      execFile(
        mysqladminPath,
        ['--port', String(this.port), '-u', 'root', 'shutdown'],
        { windowsHide: true, timeout: 5000 },
        (error) => {
          if (error) {
            this.emitLog('warning', `mysqladmin shutdown failed: ${error.message}`);
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });

    if (!commandSucceeded) {
      return false;
    }

    const stopped = await retryCheck(
      async () => !this.processManager.isRunning(PROCESS_NAME),
      { attempts: 10, delayMs: 200 }
    );

    if (stopped) {
      this.emitLog('system', 'MySQL shutdown via mysqladmin successful');
      return true;
    }

    this.emitLog('warning', 'mysqladmin command succeeded but mysqld did not exit in time');
    return false;
  }

  private async initializeDataDir(
    mysqldPath: string,
    dataDir: string,
    baseDir: string
  ): Promise<void> {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    assertExecutable(mysqldPath, 'MySQL');
    this.emitLog('system', 'Running mysqld --initialize-insecure...');

    await new Promise<void>((resolve, reject) => {
      execFile(
        mysqldPath,
        [`--basedir=${baseDir}`, `--datadir=${dataDir}`, '--initialize-insecure'],
        { windowsHide: true, timeout: 30000 },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(`MySQL data initialization failed: ${error.message}`));
            return;
          }

          if (stderr) {
            this.emitLog('system', `MySQL init output: ${stderr.substring(0, 250)}`);
          }
          this.emitLog('success', 'MySQL data directory initialized');
          resolve();
        }
      );
    });
  }

  private resolveBinaryPath(): string | null {
    const savedPath = ConfigStore.getBinaryPath('mysql');
    if (savedPath) {
      const exe = path.join(savedPath, 'bin', 'mysqld.exe');
      if (fs.existsSync(exe)) return exe;
    }

    const bundledPaths = getBundledBinaryRoots().map((root) =>
      path.join(root, 'mysql', 'bin', 'mysqld.exe')
    );
    for (const binaryPath of bundledPaths) {
      if (fs.existsSync(binaryPath)) return binaryPath;
    }

    const commonPaths = [
      'C:\\MySQL\\bin\\mysqld.exe',
      'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe',
      'C:\\devstack\\mysql\\bin\\mysqld.exe',
    ];

    for (const binaryPath of commonPaths) {
      if (fs.existsSync(binaryPath)) return binaryPath;
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
