/**
 * Apache Service Manager (Mock Implementation)
 *
 * Simulates Apache web server lifecycle management for Phase 1.
 * In later phases, this will be replaced with actual process management
 * using child_process to start/stop real Apache instances.
 */

import type { ServiceState } from '../../src/types';

/** Callback type for emitting log messages to the main process */
type LogEmitter = (level: string, message: string) => void;

export class ApacheService {
  private running = false;
  private mockPid = 0;
  private version = '8.5.1';
  private port = 80;
  private logEmitter: LogEmitter | null = null;

  /**
   * Register a callback to receive log messages from this service.
   * The main process uses this to broadcast logs to the renderer.
   */
  setLogEmitter(emitter: LogEmitter): void {
    this.logEmitter = emitter;
  }

  /**
   * Start the Apache service.
   * Simulates a 2-second startup delay and generates mock log entries.
   *
   * @param version - Apache version to simulate (default: '8.5.1')
   * @param port - Port number to listen on (default: 80)
   * @throws Error if the service is already running
   */
  async start(version: string = '8.5.1', port: number = 80): Promise<void> {
    if (this.running) {
      throw new Error('Apache is already running');
    }

    this.version = version;
    this.port = port;

    this.emitLog('system', 'Starting Apache Web Server...');
    this.emitLog('system', `Loading configuration (port: ${this.port})...`);

    // Simulate startup delay
    await new Promise((resolve) => setTimeout(resolve, 2000));

    this.running = true;
    this.mockPid = Math.floor(Math.random() * 90000) + 10000;

    this.emitLog('success', `Apache started successfully (PID: ${this.mockPid})`);
    this.emitLog('success', `Listening on port ${this.port}`);
  }

  /**
   * Stop the Apache service.
   * Simulates a 1-second shutdown delay.
   *
   * @throws Error if the service is not running
   */
  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('Apache is not running');
    }

    this.emitLog('system', 'Stopping Apache Web Server...');

    // Simulate shutdown delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const previousPid = this.mockPid;
    this.running = false;
    this.mockPid = 0;

    this.emitLog('success', `Apache stopped (PID: ${previousPid})`);
  }

  /**
   * Get the current status of the Apache service.
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
