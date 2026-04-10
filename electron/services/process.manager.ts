/**
 * Central Process Controller
 *
 * Manages all service instances and provides a unified interface
 * for the Electron main process to interact with services.
 * Acts as a facade over individual service managers.
 */

import { BrowserWindow } from 'electron';
import { ApacheService } from './apache.service';
import { MySQLService } from './mysql.service';
import type { ServiceName, ServiceState, ServiceResult, LogEntry } from '../../src/types';

export class ProcessManager {
  private apache: ApacheService;
  private mysql: MySQLService;
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.apache = new ApacheService();
    this.mysql = new MySQLService();

    // Wire up log emitters so service logs are broadcast to the renderer
    this.apache.setLogEmitter((level, message) => this.broadcastLog(level, message));
    this.mysql.setLogEmitter((level, message) => this.broadcastLog(level, message));
  }

  /**
   * Set the main BrowserWindow reference so we can send IPC messages
   * to the renderer process (log entries, status changes, etc.)
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Start a service by name.
   *
   * @param service - 'apache' or 'mysql'
   * @param config - Optional configuration (version, port, etc.)
   * @returns ServiceResult indicating success or failure
   */
  async startService(service: ServiceName, config?: Record<string, unknown>): Promise<ServiceResult> {
    try {
      const instance = this.getServiceInstance(service);

      if (service === 'apache') {
        await (instance as ApacheService).start(
          (config?.version as string) ?? '8.5.1',
          (config?.port as number) ?? 80
        );
      } else {
        await (instance as MySQLService).start(
          (config?.version as string) ?? '8.0',
          (config?.port as number) ?? 3306
        );
      }

      // Notify the renderer about the status change
      this.broadcastServiceStatus(service);

      return { success: true, message: `${service} started successfully` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.broadcastLog('error', `Failed to start ${service}: ${errorMessage}`);
      return { success: false, message: `Failed to start ${service}`, error: errorMessage };
    }
  }

  /**
   * Stop a service by name.
   *
   * @param service - 'apache' or 'mysql'
   * @returns ServiceResult indicating success or failure
   */
  async stopService(service: ServiceName): Promise<ServiceResult> {
    try {
      const instance = this.getServiceInstance(service);

      if (service === 'apache') {
        await (instance as ApacheService).stop();
      } else {
        await (instance as MySQLService).stop();
      }

      // Notify the renderer about the status change
      this.broadcastServiceStatus(service);

      return { success: true, message: `${service} stopped successfully` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.broadcastLog('error', `Failed to stop ${service}: ${errorMessage}`);
      return { success: false, message: `Failed to stop ${service}`, error: errorMessage };
    }
  }

  /**
   * Get the current status of a service.
   */
  getServiceStatus(service: ServiceName): ServiceState {
    return this.getServiceInstance(service).getStatus();
  }

  /**
   * Stop all running services. Called during application shutdown
   * to ensure clean exit.
   */
  async stopAllServices(): Promise<void> {
    const apacheStatus = this.apache.getStatus();
    const mysqlStatus = this.mysql.getStatus();

    if (apacheStatus.status === 'running') {
      await this.stopService('apache');
    }
    if (mysqlStatus.status === 'running') {
      await this.stopService('mysql');
    }
  }

  /**
   * Get the service instance by name.
   * Ensures type safety for service routing.
   */
  private getServiceInstance(service: ServiceName): ApacheService | MySQLService {
    switch (service) {
      case 'apache':
        return this.apache;
      case 'mysql':
        return this.mysql;
      default:
        throw new Error(`Unknown service: ${service}`);
    }
  }

  /**
   * Broadcast a log entry to the renderer process via IPC.
   * Log entries are sent with a unique ID and timestamp.
   */
  private broadcastLog(level: string, message: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const logEntry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
      level: level as LogEntry['level'],
      message,
    };

    this.mainWindow.webContents.send('log:entry', logEntry);
  }

  /**
   * Broadcast a service status change to the renderer process.
   */
  private broadcastServiceStatus(service: ServiceName): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const status = this.getServiceStatus(service);
    this.mainWindow.webContents.send('service:status-change', { service, status });
  }
}
