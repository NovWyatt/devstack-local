/**
 * Core type definitions for DevStack Local.
 * These types are shared between the Electron main process and the React renderer.
 */

import type { DomainInput, DomainOperationResult, DomainRecord } from './domain.types';
import type { DatabaseListResult, DatabaseOperationResult } from './database.types';
import type { PhpExtension, PhpOperationResult, PhpVersion } from './php.types';

/** Supported service identifiers */
export type ServiceName = 'apache' | 'mysql';

/** Possible states for a managed service */
export type ServiceStatusType = 'running' | 'stopped' | 'starting' | 'stopping';

/**
 * Represents the current state of a managed service (Apache or MySQL).
 * Includes runtime information like PID and uptime when the service is active.
 */
export interface ServiceState {
  status: ServiceStatusType;
  version: string;
  port: number;
  pid?: number;
  uptime?: number;
}

/** Supported log severity levels */
export type LogLevel = 'system' | 'success' | 'error' | 'warning';

/**
 * A single log entry displayed in the System Logs viewer.
 * Each entry has a unique ID, timestamp, severity level, and human-readable message.
 */
export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
}

/**
 * Represents a navigation item in the sidebar.
 */
export interface NavItem {
  label: string;
  path: string;
  icon: string;
}

/**
 * Result of a service start/stop operation.
 * Used for IPC communication between main and renderer processes.
 */
export interface ServiceResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Service status payload sent from the main process to the renderer
 * when a service's state changes.
 */
export interface ServiceStatusPayload {
  service: ServiceName;
  status: ServiceState;
}

/**
 * The API exposed to the renderer process via contextBridge (preload script).
 * Provides methods for service control and log management.
 */
export interface ElectronAPI {
  /** Start a service (apache or mysql) with optional configuration */
  startService: (service: ServiceName, config?: Record<string, unknown>) => Promise<ServiceResult>;

  /** Stop a running service */
  stopService: (service: ServiceName) => Promise<ServiceResult>;

  /** Restart a service (stop + start) */
  restartService: (service: ServiceName) => Promise<ServiceResult>;

  /** Get the current status of a service */
  getServiceStatus: (service: ServiceName) => Promise<ServiceState>;

  /** Subscribe to real-time log entries from the main process */
  onLogEntry: (callback: (log: LogEntry) => void) => void;

  /** Remove the log entry listener */
  removeLogListener: () => void;

  /** Subscribe to service status change events */
  onServiceStatusChange: (callback: (payload: ServiceStatusPayload) => void) => void;

  /** Remove the service status change listener */
  removeServiceStatusListener: () => void;

  /** Subscribe to service error events */
  onServiceError: (callback: (payload: { service: string; error: string }) => void) => void;

  /** Remove service error listeners */
  removeServiceErrorListener: () => void;

  /** Request graceful app exit (confirmation dialog in main process) */
  exitApp: () => Promise<void>;

  /** Get all available PHP versions */
  phpGetVersions: () => Promise<PhpVersion[]>;

  /** Set active PHP version */
  phpSetActive: (version: string) => Promise<PhpOperationResult>;

  /** Get active PHP version */
  phpGetActive: () => Promise<string>;

  /** Get php.ini content for a version */
  phpGetIni: (version: string) => Promise<string>;

  /** Save php.ini content for a version */
  phpSaveIni: (version: string, content: string) => Promise<PhpOperationResult>;

  /** Get extension list for a version */
  phpGetExtensions: (version: string) => Promise<PhpExtension[]>;

  /** Toggle extension state in php.ini */
  phpToggleExtension: (
    version: string,
    extensionName: string,
    enabled: boolean
  ) => Promise<PhpOperationResult>;

  /** Download/install a PHP version */
  phpDownload: (version: string) => Promise<PhpOperationResult>;

  /** Remove an installed PHP version */
  phpRemoveVersion: (version: string) => Promise<PhpOperationResult>;

  /** Subscribe to PHP download progress events */
  onPhpDownloadProgress: (callback: (version: string, progress: number) => void) => void;

  /** Remove all PHP download progress listeners */
  removePhpDownloadProgressListener: () => void;

  /** List configured domains */
  domainsList: () => Promise<DomainRecord[]>;

  /** Create a domain entry */
  domainsCreate: (payload: DomainInput) => Promise<DomainOperationResult>;

  /** Update a domain entry */
  domainsUpdate: (id: string, payload: DomainInput) => Promise<DomainOperationResult>;

  /** Delete a domain entry */
  domainsDelete: (id: string) => Promise<DomainOperationResult>;

  /** Open a configured domain in default browser */
  domainsOpen: (hostname: string) => Promise<{ success: boolean; message: string; error?: string }>;

  /** Open native directory picker and return selected path */
  domainsPickProjectPath: () => Promise<string | null>;

  /** List MySQL databases */
  dbList: () => Promise<DatabaseListResult>;

  /** Create a MySQL database */
  dbCreate: (name: string) => Promise<DatabaseOperationResult>;

  /** Delete a MySQL database */
  dbDelete: (name: string) => Promise<DatabaseOperationResult>;

  /** Import a .sql file into a database (opens picker when filePath omitted) */
  dbImport: (databaseName: string, filePath?: string) => Promise<DatabaseOperationResult>;

  /** Export a database to .sql (opens save dialog when filePath omitted) */
  dbExport: (databaseName: string, filePath?: string) => Promise<DatabaseOperationResult>;
}

/**
 * Extend the global Window interface to include the electronAPI bridge.
 * This allows type-safe access to window.electronAPI throughout the renderer.
 */
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
