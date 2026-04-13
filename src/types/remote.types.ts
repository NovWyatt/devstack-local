/**
 * Remote connection (SFTP / FTP) type definitions for DevStack Local.
 */

export type RemoteProtocol = 'sftp' | 'ftp';

export type RemoteConnectionRuntimeStatus = 'connected' | 'disconnected' | 'error';

export type RemoteEntryType = 'file' | 'directory' | 'symlink' | 'unknown';

/** Non-sensitive persisted connection metadata. */
export interface RemoteConnectionRecord {
  id: string;
  name: string;
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  rootPath: string;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Sensitive encrypted payload kept separate from connection metadata. */
export interface RemoteConnectionSecretRecord {
  connectionId: string;
  encryptedPassword: string;
  updatedAt: string;
  label: 'remote-sensitive';
}

/** Runtime view of a saved connection shown in the UI. */
export interface RemoteConnectionSummary extends RemoteConnectionRecord {
  status: RemoteConnectionRuntimeStatus;
  lastError?: string;
}

/** Add/edit payload from the renderer. */
export interface RemoteConnectionInput {
  name: string;
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  password?: string;
  rootPath?: string;
}

/** Single remote file/directory row for root previews. */
export interface RemoteDirectoryEntry {
  name: string;
  path: string;
  type: RemoteEntryType;
  size: number | null;
  modifiedAt: string | null;
}

/** Generic operation result for CRUD/disconnect flows. */
export interface RemoteConnectionOperationResult {
  success: boolean;
  message: string;
  error?: string;
  connection?: RemoteConnectionSummary;
  connectionId?: string;
}

/** One-shot connection test result with a root listing preview. */
export interface RemoteConnectionTestResult {
  success: boolean;
  message: string;
  error?: string;
  protocol: RemoteProtocol;
  rootPath: string;
  entries: RemoteDirectoryEntry[];
}

/** Connect result for saved connections. */
export interface RemoteConnectionConnectResult {
  success: boolean;
  message: string;
  error?: string;
  connection?: RemoteConnectionSummary;
  connectionId: string;
  rootPath: string;
  entries: RemoteDirectoryEntry[];
}

/** Root directory preview result for an active connection. */
export interface RemoteDirectoryListResult {
  success: boolean;
  message: string;
  error?: string;
  connectionId: string;
  rootPath: string;
  entries: RemoteDirectoryEntry[];
}
