/**
 * MySQL Service Manager (Mock Implementation)
 *
 * Simulates MySQL database server lifecycle management for Phase 1.
 * In later phases, this will be replaced with actual process management
 * to start/stop real MySQL instances.
 */

import type { ServiceState } from '../../src/types';

/** Callback type for emitting log messages to the main process */
type LogEmitter = (level: string, message: string) => void;

export class MySQLService {
  private running = false;
  private mockPid = 0;
  private version = '8.0';
  private port = 3306;
  private logEmitter: LogEmitter | null = null;

  /**
   * Register a callback to receive log messages from this service.
   * The main process uses this to broadcast logs to the renderer.
   */
  setLogEmitter(emitter: LogEmitter): void {
    this.logEmitter = emitter;
  }

  /**
   * Start the MySQL service.
   * Simulates a 2.5-second startup delay (DB startup is typically slower)
   * and generates mock log entries.
   *
   * @param version - MySQL version to simulate (default: '8.0')
   * @param port - Port number to listen on (default: 3306)
   * @throws Error if the service is already running
   */
  async start(version: string = '8.0', port: number = 3306): Promise<void> {
    if (this.running) {
      throw new Error('MySQL is already running');
    }

    this.version = version;
    this.port = port;

    this.emitLog('system', 'Starting MySQL Database Server...');
    this.emitLog('system', `Initializing InnoDB engine (port: ${this.port})...`);

    // Simulate startup delay (slightly longer than Apache for realism)
    await new Promise((resolve) => setTimeout(resolve, 2500));

    this.running = true;
    this.mockPid = Math.floor(Math.random() * 90000) + 10000;

    this.emitLog('success', `MySQL started successfully (PID: ${this.mockPid})`);
    this.emitLog('success', `Accepting connections on port ${this.port}`);
  }

  /**
   * Stop the MySQL service.
   * Simulates a 1.5-second shutdown delay (DB shutdown involves flushing).
   *
   * @throws Error if the service is not running
   */
  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('MySQL is not running');
    }

    this.emitLog('system', 'Stopping MySQL Database Server...');
    this.emitLog('system', 'Flushing tables and closing connections...');

    // Simulate shutdown delay
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const previousPid = this.mockPid;
    this.running = false;
    this.mockPid = 0;

    this.emitLog('success', `MySQL stopped (PID: ${previousPid})`);
  }

  /**
   * Get the current status of the MySQL service.
   * Returns a snapshot of the service state including run status, version, port, and PID.
   */
  getStatus(): ServiceState {
    return {
      status: this.running ? 'running' : 'stopped',
      version: this.version,
      port: this.port,
      pid: this.running ? this.mockPid : undefined,
    };
  }

  /** Emit a log message through the registered emitter */
  private emitLog(level: string, message: string): void {
    if (this.logEmitter) {
      this.logEmitter(level, message);
    }
  }
}
