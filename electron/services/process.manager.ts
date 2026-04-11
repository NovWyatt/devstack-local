/**
 * ProcessManager - central process controller.
 *
 * Handles child process lifecycle, crash recovery, health monitoring,
 * and log broadcasting for Apache, MySQL, and PHP-CGI processes.
 */

import { ChildProcess, spawn, SpawnOptions } from 'child_process';
import { BrowserWindow } from 'electron';
import treeKill from 'tree-kill';
import type { ServiceName, ServiceState, ServiceResult, LogEntry } from '../../src/types';
import { assertExecutable } from '../utils/binary.util';
import { isPortListening } from '../utils/port.util';
import { retryCheck } from '../utils/retry.util';
import { ApacheService } from './apache.service';
import { MySQLService } from './mysql.service';

interface ProcessHealthCheck {
  port: number;
  host?: string;
}

interface TrackedProcess {
  process: ChildProcess;
  name: string;
  command: string;
  args: string[];
  options?: SpawnOptions;
  autoRestart: boolean;
  intentionallyStopped: boolean;
  healthCheck?: ProcessHealthCheck;
  pendingFailureReason?: string;
}

export class ProcessManager {
  private processes: Map<string, TrackedProcess> = new Map();
  private apache: ApacheService;
  private mysql: MySQLService;
  private mainWindow: BrowserWindow | null = null;

  private readonly MAX_RESTART_ATTEMPTS = 3;
  private readonly RESTART_BACKOFF_MS = [1000, 2000, 5000];
  private readonly HEALTH_CHECK_INTERVAL_MS = 5000;

  private restartAttempts: Map<string, number> = new Map();
  private restartTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private healthCheckRunning = false;
  private shutdownRequested = false;

  private logBuffer: LogEntry[] = [];
  private logFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly LOG_BATCH_INTERVAL_MS = 100;
  private readonly MAX_LOG_BUFFER_SIZE = 1000;

  constructor() {
    this.apache = new ApacheService(this);
    this.mysql = new MySQLService(this);
    this.startHealthMonitor();
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  getApacheService(): ApacheService {
    return this.apache;
  }

  getMySQLService(): MySQLService {
    return this.mysql;
  }

  startProcess(
    name: string,
    command: string,
    args: string[],
    options?: SpawnOptions,
    autoRestart: boolean = false,
    healthCheck?: ProcessHealthCheck
  ): ChildProcess {
    if (this.shutdownRequested) {
      throw new Error('Cannot start processes while shutdown is in progress');
    }

    this.clearPendingRestart(name, true);

    const existing = this.processes.get(name);
    if (existing && this.isChildAlive(existing.process)) {
      throw new Error(`[${name}] Process is already running (PID: ${existing.process.pid ?? 'unknown'})`);
    }
    if (existing) {
      this.processes.delete(name);
    }

    return this.spawnTrackedProcess(name, command, args, options, autoRestart, healthCheck, false);
  }

  async stopProcess(name: string, timeoutMs: number = 5000): Promise<boolean> {
    this.clearPendingRestart(name, true);

    const entry = this.processes.get(name);
    if (!entry) {
      return true;
    }

    entry.intentionallyStopped = true;
    entry.pendingFailureReason = undefined;

    const pid = entry.process.pid;
    if (!pid) {
      this.processes.delete(name);
      return true;
    }

    this.broadcastLog('system', `[${name}] Stopping process (PID: ${pid})...`);

    this.killProcessTree(pid, 'SIGTERM');
    let exited = await this.waitForPidExit(pid, timeoutMs);

    if (!exited) {
      this.broadcastLog('warning', `[${name}] Graceful stop timed out. Forcing SIGKILL...`);
      this.killProcessTree(pid, 'SIGKILL');
      exited = await this.waitForPidExit(pid, 2000);
    }

    if (!exited) {
      this.broadcastLog('warning', `[${name}] Process may still be alive after forced stop`);
    }

    this.processes.delete(name);
    return true;
  }

  async restartProcess(name: string): Promise<boolean> {
    const entry = this.processes.get(name);
    if (!entry) {
      this.broadcastLog('warning', `[${name}] No process found to restart`);
      return false;
    }

    const { command, args, options, autoRestart, healthCheck } = entry;
    await this.stopProcess(name);
    this.startProcess(name, command, args, options, autoRestart, healthCheck);
    return true;
  }

  isRunning(name: string): boolean {
    const entry = this.processes.get(name);
    if (!entry) return false;

    if (!this.isChildAlive(entry.process)) {
      this.processes.delete(name);
      return false;
    }

    return true;
  }

  getProcessPid(name: string): number | undefined {
    const entry = this.processes.get(name);
    return entry?.process?.pid;
  }

  resetRestartAttempts(name: string): void {
    this.restartAttempts.delete(name);
  }

  markProcessIntentionalStop(name: string): void {
    const entry = this.processes.get(name);
    if (entry) {
      entry.intentionallyStopped = true;
      entry.pendingFailureReason = undefined;
    }
    this.clearPendingRestart(name, true);
  }

  async startService(service: ServiceName, config?: Record<string, unknown>): Promise<ServiceResult> {
    try {
      if (service === 'apache') {
        await this.apache.start(config?.version as string, config?.port as number);
      } else if (service === 'mysql') {
        await this.mysql.start(config?.version as string, config?.port as number);
      } else {
        throw new Error(`Unknown service: ${service}`);
      }

      this.broadcastServiceStatus(service);
      return { success: true, message: `${service} started successfully` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.broadcastLog('error', `Failed to start ${service}: ${errorMessage}`);
      this.broadcastError(service, errorMessage);
      this.broadcastServiceStatus(service);
      return { success: false, message: `Failed to start ${service}`, error: errorMessage };
    }
  }

  async stopService(service: ServiceName): Promise<ServiceResult> {
    try {
      if (service === 'apache') {
        await this.apache.stop();
      } else if (service === 'mysql') {
        await this.mysql.stop();
      } else {
        throw new Error(`Unknown service: ${service}`);
      }

      this.broadcastServiceStatus(service);
      return { success: true, message: `${service} stopped successfully` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.broadcastLog('error', `Failed to stop ${service}: ${errorMessage}`);
      this.broadcastError(service, errorMessage);
      this.broadcastServiceStatus(service);
      return { success: false, message: `Failed to stop ${service}`, error: errorMessage };
    }
  }

  async restartService(service: ServiceName): Promise<ServiceResult> {
    try {
      await this.stopService(service);
      return await this.startService(service);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to restart ${service}`, error: errorMessage };
    }
  }

  getServiceStatus(service: ServiceName): ServiceState {
    if (service === 'apache') return this.apache.getStatus();
    if (service === 'mysql') return this.mysql.getStatus();
    throw new Error(`Unknown service: ${service}`);
  }

  async stopAllServices(): Promise<void> {
    this.shutdownRequested = true;
    this.stopHealthMonitor();
    this.clearAllRestartTimers();
    this.broadcastLog('system', 'Stopping all services...');

    const stopPromises: Promise<unknown>[] = [];

    if (this.apache.getStatus().status !== 'stopped') {
      stopPromises.push(
        this.apache.stop().catch((error: Error) => {
          this.broadcastLog('error', `Failed to stop Apache: ${error.message}`);
        })
      );
    }

    if (this.mysql.getStatus().status !== 'stopped') {
      stopPromises.push(
        this.mysql.stop().catch((error: Error) => {
          this.broadcastLog('error', `Failed to stop MySQL: ${error.message}`);
        })
      );
    }

    await Promise.allSettled(stopPromises);

    const remainingProcesses = Array.from(this.processes.keys());
    for (const name of remainingProcesses) {
      await this.stopProcess(name);
    }

    this.processes.clear();
    this.restartAttempts.clear();
    this.broadcastLog('system', 'All services stopped');
  }

  broadcastLog(level: string, message: string): void {
    const logEntry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
      level: level as LogEntry['level'],
      message,
    };

    if (this.logBuffer.length >= this.MAX_LOG_BUFFER_SIZE) {
      const overflow = this.logBuffer.length - this.MAX_LOG_BUFFER_SIZE + 1;
      this.logBuffer.splice(0, overflow);
    }

    this.logBuffer.push(logEntry);

    if (!this.logFlushTimer) {
      this.logFlushTimer = setTimeout(() => {
        this.flushLogs();
      }, this.LOG_BATCH_INTERVAL_MS);
    }
  }

  broadcastServiceStatus(service: ServiceName): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const status = this.getServiceStatus(service);
    this.mainWindow.webContents.send('service:status-change', { service, status });
  }

  broadcastError(service: string, error: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('service:error', { service, error });
  }

  private spawnTrackedProcess(
    name: string,
    command: string,
    args: string[],
    options: SpawnOptions | undefined,
    autoRestart: boolean,
    healthCheck: ProcessHealthCheck | undefined,
    isAutoRestart: boolean
  ): ChildProcess {
    assertExecutable(command, name);

    if (!isAutoRestart) {
      this.restartAttempts.delete(name);
    }

    const spawnOptions: SpawnOptions = {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    };

    this.broadcastLog(
      'system',
      `[${name}] Spawning${isAutoRestart ? ' (auto-restart)' : ''}: ${command} ${args.join(' ')}`
    );

    const child = spawn(command, args, spawnOptions);

    const tracked: TrackedProcess = {
      process: child,
      name,
      command,
      args,
      options: spawnOptions,
      autoRestart,
      intentionallyStopped: false,
      healthCheck,
    };

    this.processes.set(name, tracked);

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            this.broadcastLog('system', `[${name}] ${trimmed}`);
          }
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            this.broadcastLog('warning', `[${name}] ${trimmed}`);
          }
        }
      });
    }

    child.once('exit', (code, signal) => {
      this.handleProcessExit(name, child.pid, code, signal);
    });

    child.once('error', (error) => {
      const current = this.processes.get(name);
      if (current && current.process.pid === child.pid) {
        current.pendingFailureReason = `Spawn error: ${error.message}`;
        this.handleProcessExit(name, child.pid, child.exitCode, child.signalCode);
      }
    });

    return child;
  }

  private handleProcessExit(
    name: string,
    pid: number | undefined,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    const entry = this.processes.get(name);
    if (!entry) return;

    if (pid && entry.process.pid && pid !== entry.process.pid) {
      return;
    }

    this.processes.delete(name);

    if (entry.intentionallyStopped || this.shutdownRequested) {
      this.broadcastLog('system', `[${name}] Process exited (code: ${code ?? 'null'})`);
      this.broadcastStatusForCoreService(name);
      return;
    }

    const reason =
      entry.pendingFailureReason ??
      `Process crashed (code: ${code ?? 'null'}, signal: ${signal ?? 'none'})`;

    this.broadcastLog('error', `[${name}] ${reason}`);
    this.broadcastError(name, reason);
    this.broadcastStatusForCoreService(name);

    this.scheduleRestart(name, entry);
  }

  private scheduleRestart(name: string, entry: TrackedProcess): void {
    if (!entry.autoRestart || this.shutdownRequested) {
      return;
    }

    if (this.restartTimers.has(name)) {
      return;
    }

    const attemptCount = this.restartAttempts.get(name) ?? 0;
    if (attemptCount >= this.MAX_RESTART_ATTEMPTS) {
      const message = `[${name}] Restart limit exceeded (${this.MAX_RESTART_ATTEMPTS} attempts). Service remains stopped.`;
      this.broadcastLog('error', message);
      this.broadcastError(name, message);
      return;
    }

    const nextAttempt = attemptCount + 1;
    this.restartAttempts.set(name, nextAttempt);

    const delayMs =
      this.RESTART_BACKOFF_MS[Math.min(nextAttempt - 1, this.RESTART_BACKOFF_MS.length - 1)];

    this.broadcastLog(
      'warning',
      `[${name}] Restart attempt ${nextAttempt}/${this.MAX_RESTART_ATTEMPTS} in ${delayMs}ms`
    );

    const timer = setTimeout(() => {
      this.restartTimers.delete(name);

      try {
        this.spawnTrackedProcess(
          name,
          entry.command,
          entry.args,
          entry.options,
          entry.autoRestart,
          entry.healthCheck,
          true
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.broadcastLog('error', `[${name}] Restart attempt ${nextAttempt} failed: ${message}`);
        this.broadcastError(name, message);
        this.scheduleRestart(name, entry);
      }
    }, delayMs);

    this.restartTimers.set(name, timer);
  }

  private startHealthMonitor(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(() => {
      void this.runHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthMonitor(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private async runHealthChecks(): Promise<void> {
    if (this.healthCheckRunning || this.shutdownRequested) return;
    this.healthCheckRunning = true;

    try {
      const entries = Array.from(this.processes.entries());
      for (const [name, entry] of entries) {
        const current = this.processes.get(name);
        if (!current || current.process.pid !== entry.process.pid || entry.intentionallyStopped) {
          continue;
        }

        const pid = entry.process.pid;
        if (!pid || !this.isChildAlive(entry.process)) {
          entry.pendingFailureReason = 'Health check failed: process is not alive';
          this.handleProcessExit(name, pid, entry.process.exitCode, entry.process.signalCode);
          continue;
        }

        if (entry.healthCheck) {
          const host = entry.healthCheck.host ?? '127.0.0.1';
          const open = await isPortListening(entry.healthCheck.port, host, 1000);
          if (!open) {
            entry.pendingFailureReason = `Health check failed: port ${entry.healthCheck.port} is closed`;
            this.broadcastLog('error', `[${name}] ${entry.pendingFailureReason}`);
            this.killProcessTree(pid, 'SIGTERM');
            this.handleProcessExit(name, pid, entry.process.exitCode, entry.process.signalCode);
            continue;
          }
        }

        const attempts = this.restartAttempts.get(name) ?? 0;
        if (attempts > 0) {
          this.restartAttempts.delete(name);
          this.broadcastLog('success', `[${name}] Health check passed after restart`);
        }
      }
    } finally {
      this.healthCheckRunning = false;
    }
  }

  private flushLogs(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.logBuffer = [];
      this.logFlushTimer = null;
      return;
    }

    for (const entry of this.logBuffer) {
      this.mainWindow.webContents.send('log:entry', entry);
    }

    this.logBuffer = [];
    this.logFlushTimer = null;
  }

  private clearPendingRestart(name: string, clearAttempts: boolean): void {
    const timer = this.restartTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(name);
    }

    if (clearAttempts) {
      this.restartAttempts.delete(name);
    }
  }

  private clearAllRestartTimers(): void {
    for (const timer of this.restartTimers.values()) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();
  }

  private broadcastStatusForCoreService(name: string): void {
    if (name === 'apache' || name === 'mysql') {
      this.broadcastServiceStatus(name);
    }
  }

  private isChildAlive(child: ChildProcess): boolean {
    if (!child.pid) return false;
    try {
      process.kill(child.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
    const attempts = Math.max(1, Math.ceil(timeoutMs / 100));
    return retryCheck(
      async () => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      },
      { attempts, delayMs: 100 }
    );
  }

  private killProcessTree(pid: number, signal: string): void {
    try {
      treeKill(pid, signal, () => {
        // No-op callback; process might already be gone.
      });
    } catch {
      // Already dead.
    }
  }
}
