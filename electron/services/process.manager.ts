/**
 * ProcessManager — Central Process Controller
 *
 * Manages all spawned child processes (Apache, MySQL, PHP-CGI).
 * Provides a unified interface for starting, stopping, restarting,
 * and monitoring service processes. Uses tree-kill for reliable
 * Windows process tree cleanup.
 *
 * Features:
 * - Map<string, ChildProcess> for active process tracking
 * - Log batching (100ms intervals) to prevent UI lag
 * - Crash detection with optional auto-restart
 * - Clean shutdown of all processes on app exit
 */

import { ChildProcess, spawn, SpawnOptions } from 'child_process';
import { BrowserWindow } from 'electron';
import treeKill from 'tree-kill';
import type { ServiceName, ServiceState, ServiceResult, LogEntry } from '../../src/types';
import { ApacheService } from './apache.service';
import { MySQLService } from './mysql.service';

/** Tracked process entry */
interface TrackedProcess {
  process: ChildProcess;
  name: string;
  command: string;
  args: string[];
  autoRestart: boolean;
  intentionallyStopped: boolean;
}

export class ProcessManager {
  private processes: Map<string, TrackedProcess> = new Map();
  private apache: ApacheService;
  private mysql: MySQLService;
  private mainWindow: BrowserWindow | null = null;

  /** Log batching state */
  private logBuffer: LogEntry[] = [];
  private logFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly LOG_BATCH_INTERVAL_MS = 100;

  constructor() {
    this.apache = new ApacheService(this);
    this.mysql = new MySQLService(this);
  }

  /**
   * Set the main BrowserWindow reference for IPC broadcasts.
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /** Expose apache service for direct access */
  getApacheService(): ApacheService {
    return this.apache;
  }

  /** Expose mysql service for direct access */
  getMySQLService(): MySQLService {
    return this.mysql;
  }

  // ─── Generic Process Management ────────────────────────────────────

  /**
   * Spawn a tracked child process.
   *
   * @param name - Unique identifier for the process (e.g., 'apache', 'mysql', 'php-cgi-8.3')
   * @param command - Executable path
   * @param args - Arguments array
   * @param options - SpawnOptions (cwd, env, etc.)
   * @param autoRestart - Whether to auto-restart on crash
   * @returns The spawned ChildProcess
   */
  startProcess(
    name: string,
    command: string,
    args: string[],
    options?: SpawnOptions,
    autoRestart: boolean = false
  ): ChildProcess {
    // Kill any existing process with the same name first
    if (this.processes.has(name)) {
      const existing = this.processes.get(name)!;
      if (existing.process && !existing.process.killed) {
        this.broadcastLog('warning', `[${name}] Killing existing process before restarting`);
        existing.intentionallyStopped = true;
        this.killProcessTree(existing.process.pid!);
      }
      this.processes.delete(name);
    }

    const spawnOptions: SpawnOptions = {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    };

    this.broadcastLog('system', `[${name}] Spawning: ${command} ${args.join(' ')}`);

    const child = spawn(command, args, spawnOptions);

    const tracked: TrackedProcess = {
      process: child,
      name,
      command,
      args,
      autoRestart,
      intentionallyStopped: false,
    };

    this.processes.set(name, tracked);

    // Capture stdout
    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            this.broadcastLog('system', `[${name}] ${line.trim()}`);
          }
        }
      });
    }

    // Capture stderr
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            this.broadcastLog('warning', `[${name}] ${line.trim()}`);
          }
        }
      });
    }

    // Handle process exit
    child.on('exit', (code, signal) => {
      const entry = this.processes.get(name);
      if (!entry) return;

      if (entry.intentionallyStopped) {
        this.broadcastLog('system', `[${name}] Process exited (code: ${code})`);
      } else if (code !== 0 && code !== null) {
        this.broadcastLog('error', `[${name}] Process crashed (code: ${code}, signal: ${signal})`);
        if (entry.autoRestart) {
          this.broadcastLog('system', `[${name}] Auto-restarting in 2 seconds...`);
          setTimeout(() => {
            if (!entry.intentionallyStopped) {
              this.startProcess(name, entry.command, entry.args, options, true);
            }
          }, 2000);
        }
      }

      this.processes.delete(name);
    });

    // Handle spawn errors
    child.on('error', (err) => {
      this.broadcastLog('error', `[${name}] Spawn error: ${err.message}`);
      this.processes.delete(name);
    });

    return child;
  }

  /**
   * Stop a tracked process by name using tree-kill.
   *
   * @param name - Process identifier
   * @param timeoutMs - Max wait time for graceful shutdown (default: 5000ms)
   * @returns true if process was stopped successfully
   */
  async stopProcess(name: string, timeoutMs: number = 5000): Promise<boolean> {
    const entry = this.processes.get(name);
    if (!entry) {
      this.broadcastLog('warning', `[${name}] No process found to stop`);
      return true; // Already stopped
    }

    entry.intentionallyStopped = true;
    const pid = entry.process.pid;

    if (!pid) {
      this.processes.delete(name);
      return true;
    }

    this.broadcastLog('system', `[${name}] Stopping process (PID: ${pid})...`);

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown timed out
        this.broadcastLog('warning', `[${name}] Graceful shutdown timed out, force killing...`);
        this.killProcessTree(pid);
        this.processes.delete(name);
        resolve(true);
      }, timeoutMs);

      // Listen for the exit event
      entry.process.once('exit', () => {
        clearTimeout(timeout);
        this.processes.delete(name);
        resolve(true);
      });

      // Use tree-kill for clean shutdown (SIGTERM equivalent on Windows)
      this.killProcessTree(pid);
    });
  }

  /**
   * Restart a tracked process.
   */
  async restartProcess(name: string): Promise<boolean> {
    const entry = this.processes.get(name);
    if (!entry) {
      this.broadcastLog('warning', `[${name}] No process found to restart`);
      return false;
    }

    const { command, args, autoRestart } = entry;
    await this.stopProcess(name);

    // Brief delay to ensure port is released
    await new Promise((resolve) => setTimeout(resolve, 500));

    this.startProcess(name, command, args, undefined, autoRestart);
    return true;
  }

  /**
   * Check if a named process is currently running.
   */
  isRunning(name: string): boolean {
    const entry = this.processes.get(name);
    if (!entry) return false;

    try {
      // node: process.kill(pid, 0) throws if process doesn't exist
      if (entry.process.pid) {
        process.kill(entry.process.pid, 0);
        return true;
      }
    } catch {
      // Process no longer exists
      this.processes.delete(name);
    }
    return false;
  }

  /**
   * Get the PID of a named process.
   */
  getProcessPid(name: string): number | undefined {
    const entry = this.processes.get(name);
    return entry?.process?.pid;
  }

  // ─── Service-Level Interface ──────────────────────────────────────

  /**
   * Start a service (apache or mysql).
   */
  async startService(service: ServiceName, config?: Record<string, unknown>): Promise<ServiceResult> {
    try {
      if (service === 'apache') {
        await this.apache.start(
          (config?.version as string),
          (config?.port as number)
        );
      } else if (service === 'mysql') {
        await this.mysql.start(
          (config?.version as string),
          (config?.port as number)
        );
      } else {
        throw new Error(`Unknown service: ${service}`);
      }

      this.broadcastServiceStatus(service);
      return { success: true, message: `${service} started successfully` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.broadcastLog('error', `Failed to start ${service}: ${errorMessage}`);
      this.broadcastServiceStatus(service);
      return { success: false, message: `Failed to start ${service}`, error: errorMessage };
    }
  }

  /**
   * Stop a service (apache or mysql).
   */
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
      this.broadcastServiceStatus(service);
      return { success: false, message: `Failed to stop ${service}`, error: errorMessage };
    }
  }

  /**
   * Restart a service (apache or mysql).
   */
  async restartService(service: ServiceName): Promise<ServiceResult> {
    try {
      await this.stopService(service);
      await new Promise((r) => setTimeout(r, 500));
      return await this.startService(service);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to restart ${service}`, error: errorMessage };
    }
  }

  /**
   * Get the current status of a service.
   */
  getServiceStatus(service: ServiceName): ServiceState {
    if (service === 'apache') return this.apache.getStatus();
    if (service === 'mysql') return this.mysql.getStatus();
    throw new Error(`Unknown service: ${service}`);
  }

  /**
   * Stop all running services and processes. Called on app exit.
   */
  async stopAllServices(): Promise<void> {
    this.broadcastLog('system', 'Stopping all services...');

    const stopPromises: Promise<unknown>[] = [];

    // Stop high-level services
    if (this.apache.getStatus().status === 'running') {
      stopPromises.push(this.apache.stop().catch((e) => {
        this.broadcastLog('error', `Failed to stop Apache: ${e.message}`);
      }));
    }

    if (this.mysql.getStatus().status === 'running') {
      stopPromises.push(this.mysql.stop().catch((e) => {
        this.broadcastLog('error', `Failed to stop MySQL: ${e.message}`);
      }));
    }

    await Promise.allSettled(stopPromises);

    // Kill any remaining tracked processes (PHP-CGI etc.)
    for (const [name, entry] of this.processes) {
      entry.intentionallyStopped = true;
      if (entry.process.pid) {
        this.broadcastLog('system', `Force killing remaining process: ${name}`);
        this.killProcessTree(entry.process.pid);
      }
    }
    this.processes.clear();

    this.broadcastLog('system', 'All services stopped');
  }

  // ─── Log Broadcasting ─────────────────────────────────────────────

  /**
   * Broadcast a log entry to the renderer process.
   * Uses batching (100ms intervals) to prevent UI flooding.
   */
  broadcastLog(level: string, message: string): void {
    const logEntry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
      level: level as LogEntry['level'],
      message,
    };

    this.logBuffer.push(logEntry);

    // Schedule a flush if not already pending
    if (!this.logFlushTimer) {
      this.logFlushTimer = setTimeout(() => {
        this.flushLogs();
      }, this.LOG_BATCH_INTERVAL_MS);
    }
  }

  /** Flush buffered logs to the renderer */
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

  /**
   * Broadcast a service status change to the renderer.
   */
  broadcastServiceStatus(service: ServiceName): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const status = this.getServiceStatus(service);
    this.mainWindow.webContents.send('service:status-change', { service, status });
  }

  /**
   * Broadcast a service error to the renderer.
   */
  broadcastError(service: string, error: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('service:error', { service, error });
  }

  // ─── Internal Helpers ─────────────────────────────────────────────

  /**
   * Kill a process tree using tree-kill. Critical on Windows where
   * httpd.exe / mysqld.exe spawn worker processes.
   */
  private killProcessTree(pid: number): void {
    try {
      treeKill(pid, 'SIGTERM', (err) => {
        if (err) {
          // Fallback: force kill
          try {
            treeKill(pid, 'SIGKILL');
          } catch {
            // Process may already be dead
          }
        }
      });
    } catch {
      // Process already dead — this is fine
    }
  }
}
