/**
 * RemoteService
 *
 * Safe MVP remote connection manager for saved SFTP/FTP connections.
 * Scope is intentionally limited to CRUD, connection testing, connect/disconnect,
 * and simple remote root directory previews.
 */

import path from 'path';
import { Client as FtpClient, FileType } from 'basic-ftp';
import SftpClient from 'ssh2-sftp-client';
import type {
  RemoteConnectionConnectResult,
  RemoteConnectionInput,
  RemoteConnectionOperationResult,
  RemoteConnectionRecord,
  RemoteConnectionSecretRecord,
  RemoteConnectionSummary,
  RemoteConnectionTestResult,
  RemoteDirectoryEntry,
  RemoteDirectoryListResult,
  RemoteProtocol,
} from '../../src/types/remote.types.ts';
import { ConfigStore } from '../utils/config.store.ts';

const DEFAULT_CONNECT_TIMEOUT_MS = 8000;
const DEFAULT_SFTP_PORT = 22;
const DEFAULT_FTP_PORT = 21;
const MAX_NAME_LENGTH = 80;
const MAX_HOST_LENGTH = 255;
const MAX_USERNAME_LENGTH = 128;
const MAX_PASSWORD_LENGTH = 512;
const MAX_ROOT_PATH_LENGTH = 256;
const MAX_ROOT_LIST_ENTRIES = 200;

interface RemoteProcessBridge {
  broadcastLog(level: string, message: string): void;
}

interface SensitiveValueCodec {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

interface RemoteStorage {
  getConnections(): RemoteConnectionRecord[];
  setConnections(connections: RemoteConnectionRecord[]): void;
  getSensitiveSecrets(): RemoteConnectionSecretRecord[];
  setSensitiveSecrets(secrets: RemoteConnectionSecretRecord[]): void;
}

interface ResolvedRemoteConnection {
  id: string;
  name: string;
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
  rootPath: string;
}

interface NormalizedRemoteConnectionInput {
  name: string;
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
  rootPath: string;
}

interface RemoteTransportClient {
  connect(connection: ResolvedRemoteConnection, timeoutMs: number): Promise<void>;
  list(rootPath: string): Promise<RemoteDirectoryEntry[]>;
  disconnect(): Promise<void>;
}

interface RemoteActiveSession {
  client: RemoteTransportClient;
  connection: ResolvedRemoteConnection;
}

export interface RemoteServiceOptions {
  storage?: RemoteStorage;
  secretCodec?: SensitiveValueCodec;
  transportClientFactory?: (protocol: RemoteProtocol) => RemoteTransportClient;
  connectTimeoutMs?: number;
}

function sanitizeText(value: string): string {
  return value.replace(/\0/g, '').trim();
}

function sanitizeSecret(value: string): string {
  return value.replace(/\0/g, '');
}

function normalizeRemotePath(protocol: RemoteProtocol, rawPath?: string): string {
  const fallback = protocol === 'sftp' ? '.' : '/';
  const normalized = sanitizeText(rawPath ?? '').replace(/\\/g, '/');
  if (!normalized) {
    return fallback;
  }

  if (normalized.length > MAX_ROOT_PATH_LENGTH) {
    throw new Error(`Root path is too long (max ${MAX_ROOT_PATH_LENGTH} characters)`);
  }

  return normalized;
}

function joinRemotePath(rootPath: string, name: string): string {
  if (rootPath === '/') {
    return `/${name}`;
  }

  if (rootPath === '.') {
    return `./${name}`;
  }

  return path.posix.join(rootPath, name);
}

function sortConnections(connections: RemoteConnectionSummary[]): RemoteConnectionSummary[] {
  return [...connections].sort((left, right) => left.name.localeCompare(right.name));
}

function mapSftpEntry(rootPath: string, item: { name: string; type: string; size: number; modifyTime?: number }): RemoteDirectoryEntry {
  const typeToken = item.type?.toLowerCase?.() ?? '';
  const entryType =
    typeToken.startsWith('d')
      ? 'directory'
      : typeToken.startsWith('l')
        ? 'symlink'
        : typeToken.startsWith('-')
          ? 'file'
          : 'unknown';

  return {
    name: item.name,
    path: joinRemotePath(rootPath, item.name),
    type: entryType,
    size: Number.isFinite(item.size) ? item.size : null,
    modifiedAt:
      typeof item.modifyTime === 'number' && item.modifyTime > 0
        ? new Date(item.modifyTime).toISOString()
        : null,
  };
}

function mapFtpEntry(rootPath: string, item: { name: string; type: FileType; size: number; modifiedAt?: Date }): RemoteDirectoryEntry {
  const entryType =
    item.type === FileType.Directory
      ? 'directory'
      : item.type === FileType.SymbolicLink
        ? 'symlink'
        : item.type === FileType.File
          ? 'file'
          : 'unknown';

  return {
    name: item.name,
    path: joinRemotePath(rootPath, item.name),
    type: entryType,
    size: Number.isFinite(item.size) ? item.size : null,
    modifiedAt: item.modifiedAt ? item.modifiedAt.toISOString() : null,
  };
}

class SftpTransportClient implements RemoteTransportClient {
  private client: SftpClient | null = null;

  async connect(connection: ResolvedRemoteConnection, timeoutMs: number): Promise<void> {
    const client = new SftpClient(`devstack-${connection.id}`);
    this.client = client;

    await client.connect({
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: connection.password,
      readyTimeout: timeoutMs,
    });
  }

  async list(rootPath: string): Promise<RemoteDirectoryEntry[]> {
    if (!this.client) {
      throw new Error('SFTP client is not connected');
    }

    const items = await this.client.list(rootPath);
    return items.slice(0, MAX_ROOT_LIST_ENTRIES).map((item) => mapSftpEntry(rootPath, item));
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;

    const current = this.client;
    this.client = null;
    await current.end();
  }
}

class FtpTransportClient implements RemoteTransportClient {
  private client: FtpClient | null = null;

  async connect(connection: ResolvedRemoteConnection, timeoutMs: number): Promise<void> {
    const client = new FtpClient(timeoutMs);
    client.ftp.verbose = false;
    this.client = client;

    await client.access({
      host: connection.host,
      port: connection.port,
      user: connection.username,
      password: connection.password,
      secure: false,
    });
  }

  async list(rootPath: string): Promise<RemoteDirectoryEntry[]> {
    if (!this.client) {
      throw new Error('FTP client is not connected');
    }

    const items = await this.client.list(rootPath);
    return items.slice(0, MAX_ROOT_LIST_ENTRIES).map((item) => mapFtpEntry(rootPath, item));
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;

    const current = this.client;
    this.client = null;
    current.close();
  }
}

function createDefaultTransportClient(protocol: RemoteProtocol): RemoteTransportClient {
  return protocol === 'sftp' ? new SftpTransportClient() : new FtpTransportClient();
}

export class RemoteService {
  private processBridge: RemoteProcessBridge;
  private storage: RemoteStorage;
  private secretCodec: SensitiveValueCodec;
  private transportClientFactory: (protocol: RemoteProtocol) => RemoteTransportClient;
  private connectTimeoutMs: number;
  private activeSessions = new Map<string, RemoteActiveSession>();
  private lastErrors = new Map<string, string>();

  constructor(processBridge: RemoteProcessBridge, options?: RemoteServiceOptions) {
    this.processBridge = processBridge;
    this.storage = options?.storage ?? {
      getConnections: () => ConfigStore.getRemoteConnections(),
      setConnections: (connections) => ConfigStore.setRemoteConnections(connections),
      getSensitiveSecrets: () => ConfigStore.getRemoteSensitiveSecrets(),
      setSensitiveSecrets: (secrets) => ConfigStore.setRemoteSensitiveSecrets(secrets),
    };
    this.secretCodec = options?.secretCodec ?? {
      isAvailable: () => false,
      encrypt: () => {
        throw new Error('Secret codec is unavailable');
      },
      decrypt: () => {
        throw new Error('Secret codec is unavailable');
      },
    };
    this.transportClientFactory = options?.transportClientFactory ?? createDefaultTransportClient;
    this.connectTimeoutMs = options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  async listConnections(): Promise<RemoteConnectionSummary[]> {
    return this.getConnectionSummaries();
  }

  async createConnection(input: RemoteConnectionInput): Promise<RemoteConnectionOperationResult> {
    try {
      const normalized = this.normalizeInput(input);
      this.assertSecretCodecAvailable();
      const connections = this.storage.getConnections();
      this.assertConnectionNameUnique(normalized.name, connections);

      const now = new Date().toISOString();
      const record: RemoteConnectionRecord = {
        id: this.createConnectionId(),
        name: normalized.name,
        protocol: normalized.protocol,
        host: normalized.host,
        port: normalized.port,
        username: normalized.username,
        rootPath: normalized.rootPath,
        hasPassword: true,
        createdAt: now,
        updatedAt: now,
      };

      const nextConnections = [...connections, record];
      this.storage.setConnections(nextConnections);
      this.upsertSecret(record.id, normalized.password);
      this.clearLastError(record.id);
      this.log('success', `Saved ${record.protocol.toUpperCase()} connection "${record.name}"`);

      return {
        success: true,
        message: `Connection "${record.name}" saved`,
        connection: this.toSummary(record),
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to save remote connection: ${message}`);
      return {
        success: false,
        message: 'Failed to save connection',
        error: message,
      };
    }
  }

  async updateConnection(
    id: string,
    input: RemoteConnectionInput
  ): Promise<RemoteConnectionOperationResult> {
    try {
      const connections = this.storage.getConnections();
      const existing = connections.find((item) => item.id === id);
      if (!existing) {
        return { success: false, message: 'Connection not found', error: 'NOT_FOUND' };
      }

      const normalized = this.normalizeInput(input, true);
      this.assertSecretCodecAvailable();
      this.assertConnectionNameUnique(normalized.name, connections, id);

      const resolvedPassword = this.resolvePassword(id, normalized.password, existing.hasPassword);
      const updated: RemoteConnectionRecord = {
        ...existing,
        name: normalized.name,
        protocol: normalized.protocol,
        host: normalized.host,
        port: normalized.port,
        username: normalized.username,
        rootPath: normalized.rootPath,
        hasPassword: resolvedPassword.length > 0,
        updatedAt: new Date().toISOString(),
      };

      const nextConnections = connections.map((item) => (item.id === id ? updated : item));
      this.storage.setConnections(nextConnections);
      this.upsertSecret(id, resolvedPassword);
      await this.disconnectSession(id);
      this.clearLastError(id);
      this.log('success', `Updated ${updated.protocol.toUpperCase()} connection "${updated.name}"`);

      return {
        success: true,
        message: `Connection "${updated.name}" updated`,
        connection: this.toSummary(updated),
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to update remote connection: ${message}`);
      return {
        success: false,
        message: 'Failed to update connection',
        error: message,
      };
    }
  }

  async deleteConnection(id: string): Promise<RemoteConnectionOperationResult> {
    try {
      const connections = this.storage.getConnections();
      const existing = connections.find((item) => item.id === id);
      if (!existing) {
        return { success: false, message: 'Connection not found', error: 'NOT_FOUND' };
      }

      await this.disconnectSession(id);
      this.storage.setConnections(connections.filter((item) => item.id !== id));
      this.storage.setSensitiveSecrets(
        this.storage.getSensitiveSecrets().filter((item) => item.connectionId !== id)
      );
      this.clearLastError(id);
      this.log('success', `Deleted remote connection "${existing.name}"`);

      return {
        success: true,
        message: `Connection "${existing.name}" deleted`,
        connectionId: id,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to delete remote connection: ${message}`);
      return {
        success: false,
        message: 'Failed to delete connection',
        error: message,
      };
    }
  }

  async testConnection(
    input: RemoteConnectionInput,
    existingConnectionId?: string
  ): Promise<RemoteConnectionTestResult> {
    try {
      const normalized = this.normalizeInput(input, true);
      const protocol = normalized.protocol;
      const password = this.resolvePassword(
        existingConnectionId,
        normalized.password,
        Boolean(existingConnectionId)
      );
      const connection = this.buildResolvedConnection(
        existingConnectionId ?? 'test-connection',
        normalized,
        password
      );
      const { entries, rootPath } = await this.openAndList(connection);

      if (existingConnectionId) {
        this.clearLastError(existingConnectionId);
      }

      this.log('success', `Tested ${protocol.toUpperCase()} connection to ${connection.host}:${connection.port}`);
      return {
        success: true,
        message: `${protocol.toUpperCase()} connection succeeded`,
        protocol,
        rootPath,
        entries,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      if (existingConnectionId) {
        this.setLastError(existingConnectionId, message);
      }
      this.log('error', `Remote connection test failed: ${message}`);
      return {
        success: false,
        message: 'Connection test failed',
        error: message,
        protocol: input.protocol,
        rootPath: normalizeRemotePath(input.protocol, input.rootPath),
        entries: [],
      };
    }
  }

  async connectConnection(id: string): Promise<RemoteConnectionConnectResult> {
    const fallbackRootPath = '/';

    try {
      const connection = this.resolveSavedConnection(id);
      await this.disconnectSession(id);

      const client = this.transportClientFactory(connection.protocol);
      await this.runWithTimeout(
        `Connect timed out after ${Math.floor(this.connectTimeoutMs / 1000)}s`,
        async () => {
          await client.connect(connection, this.connectTimeoutMs);
        },
        async () => {
          await this.safeDisconnectClient(client);
        }
      );

      const entries = await client.list(connection.rootPath);
      this.activeSessions.set(id, { client, connection });
      this.clearLastError(id);
      const savedRecord = this.storage.getConnections().find((item) => item.id === id);
      this.log(
        'success',
        `Connected ${connection.protocol.toUpperCase()} session "${connection.name}" (${connection.host}:${connection.port})`
      );

      return {
        success: true,
        message: `Connected to "${connection.name}"`,
        connection: savedRecord ? this.toSummary(savedRecord) : undefined,
        connectionId: id,
        rootPath: connection.rootPath,
        entries,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.setLastError(id, message);
      this.log('error', `Failed to connect remote session: ${message}`);
      return {
        success: false,
        message: 'Failed to connect',
        error: message,
        connectionId: id,
        rootPath: fallbackRootPath,
        entries: [],
      };
    }
  }

  async disconnectConnection(id: string): Promise<RemoteConnectionOperationResult> {
    try {
      const connections = this.storage.getConnections();
      const existing = connections.find((item) => item.id === id);

      await this.disconnectSession(id);
      this.clearLastError(id);

      return {
        success: true,
        message: existing ? `Disconnected "${existing.name}"` : 'Disconnected',
        connection: existing ? this.toSummary(existing) : undefined,
        connectionId: id,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.setLastError(id, message);
      this.log('warning', `Disconnect cleanup reported an error: ${message}`);
      return {
        success: true,
        message: 'Disconnected locally after cleanup warning',
        error: message,
        connectionId: id,
      };
    }
  }

  async listRemoteRoot(id: string): Promise<RemoteDirectoryListResult> {
    const session = this.activeSessions.get(id);
    if (!session) {
      return {
        success: false,
        message: 'Connection is not active',
        error: 'NOT_CONNECTED',
        connectionId: id,
        rootPath: '/',
        entries: [],
      };
    }

    try {
      const entries = await session.client.list(session.connection.rootPath);
      return {
        success: true,
        message: 'Remote root loaded',
        connectionId: id,
        rootPath: session.connection.rootPath,
        entries,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.setLastError(id, message);
      await this.disconnectSession(id);
      this.log('error', `Failed to load remote root: ${message}`);
      return {
        success: false,
        message: 'Failed to load remote root',
        error: message,
        connectionId: id,
        rootPath: session.connection.rootPath,
        entries: [],
      };
    }
  }

  async disconnectAll(): Promise<void> {
    const connectionIds = [...this.activeSessions.keys()];
    for (const connectionId of connectionIds) {
      await this.disconnectSession(connectionId);
    }
  }

  private async openAndList(
    connection: ResolvedRemoteConnection
  ): Promise<{ entries: RemoteDirectoryEntry[]; rootPath: string }> {
    const client = this.transportClientFactory(connection.protocol);

    try {
      await this.runWithTimeout(
        `Connect timed out after ${Math.floor(this.connectTimeoutMs / 1000)}s`,
        async () => {
          await client.connect(connection, this.connectTimeoutMs);
        },
        async () => {
          await this.safeDisconnectClient(client);
        }
      );
      const entries = await client.list(connection.rootPath);
      return { entries, rootPath: connection.rootPath };
    } finally {
      await this.safeDisconnectClient(client);
    }
  }

  private resolveSavedConnection(id: string): ResolvedRemoteConnection {
    const record = this.storage.getConnections().find((item) => item.id === id);
    if (!record) {
      throw new Error('Connection not found');
    }

    const password = this.resolvePassword(id, '', record.hasPassword);
    return {
      id: record.id,
      name: record.name,
      protocol: record.protocol,
      host: record.host,
      port: record.port,
      username: record.username,
      password,
      rootPath: record.rootPath,
    };
  }

  private buildResolvedConnection(
    id: string,
    input: NormalizedRemoteConnectionInput,
    password: string
  ): ResolvedRemoteConnection {
    return {
      id,
      name: input.name,
      protocol: input.protocol,
      host: input.host,
      port: input.port,
      username: input.username,
      password,
      rootPath: input.rootPath,
    };
  }

  private normalizeInput(
    input: RemoteConnectionInput,
    allowBlankPassword: boolean = false
  ): NormalizedRemoteConnectionInput {
    const name = sanitizeText(input.name);
    if (!name) {
      throw new Error('Connection name is required');
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new Error(`Connection name is too long (max ${MAX_NAME_LENGTH} characters)`);
    }

    const protocol = input.protocol;
    if (protocol !== 'sftp' && protocol !== 'ftp') {
      throw new Error('Protocol must be SFTP or FTP');
    }

    const host = sanitizeText(input.host).toLowerCase();
    if (!host) {
      throw new Error('Host is required');
    }
    if (host.includes('://')) {
      throw new Error('Host must not include a protocol prefix');
    }
    if (host.length > MAX_HOST_LENGTH) {
      throw new Error(`Host is too long (max ${MAX_HOST_LENGTH} characters)`);
    }
    if (!/^[a-z0-9.-]+$/i.test(host)) {
      throw new Error('Host contains invalid characters');
    }

    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Port must be between 1 and 65535');
    }

    const username = sanitizeText(input.username);
    if (!username) {
      throw new Error('Username is required');
    }
    if (username.length > MAX_USERNAME_LENGTH) {
      throw new Error(`Username is too long (max ${MAX_USERNAME_LENGTH} characters)`);
    }

    const password = sanitizeSecret(input.password ?? '');
    if (!allowBlankPassword && !password) {
      throw new Error('Password is required');
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new Error(`Password is too long (max ${MAX_PASSWORD_LENGTH} characters)`);
    }

    return {
      name,
      protocol,
      host,
      port: port || (protocol === 'sftp' ? DEFAULT_SFTP_PORT : DEFAULT_FTP_PORT),
      username,
      password,
      rootPath: normalizeRemotePath(protocol, input.rootPath),
    };
  }

  private resolvePassword(
    connectionId: string | undefined,
    providedPassword: string,
    allowStoredPassword: boolean
  ): string {
    if (providedPassword) {
      this.assertSecretCodecAvailable();
      return providedPassword;
    }

    if (!allowStoredPassword || !connectionId) {
      throw new Error('Password is required');
    }

    const secret = this.storage
      .getSensitiveSecrets()
      .find((item) => item.connectionId === connectionId);
    if (!secret?.encryptedPassword) {
      throw new Error('Stored password is unavailable');
    }

    this.assertSecretCodecAvailable();
    return this.secretCodec.decrypt(secret.encryptedPassword);
  }

  private upsertSecret(connectionId: string, password: string): void {
    this.assertSecretCodecAvailable();
    const encryptedPassword = this.secretCodec.encrypt(password);
    const nextSecret: RemoteConnectionSecretRecord = {
      connectionId,
      encryptedPassword,
      updatedAt: new Date().toISOString(),
      label: 'remote-sensitive',
    };
    const secrets = this.storage.getSensitiveSecrets();
    const existingIndex = secrets.findIndex((item) => item.connectionId === connectionId);

    if (existingIndex === -1) {
      this.storage.setSensitiveSecrets([...secrets, nextSecret]);
      return;
    }

    const nextSecrets = [...secrets];
    nextSecrets[existingIndex] = nextSecret;
    this.storage.setSensitiveSecrets(nextSecrets);
  }

  private assertConnectionNameUnique(
    name: string,
    connections: RemoteConnectionRecord[],
    ignoreId?: string
  ): void {
    const duplicate = connections.find(
      (item) => item.name.toLowerCase() === name.toLowerCase() && item.id !== ignoreId
    );

    if (duplicate) {
      throw new Error(`Connection name "${name}" is already in use`);
    }
  }

  private getConnectionSummaries(): RemoteConnectionSummary[] {
    const connections = this.storage.getConnections().map((item) => this.toSummary(item));
    return sortConnections(connections);
  }

  private toSummary(record: RemoteConnectionRecord): RemoteConnectionSummary {
    const active = this.activeSessions.has(record.id);
    const lastError = this.lastErrors.get(record.id);

    return {
      ...record,
      status: active ? 'connected' : lastError ? 'error' : 'disconnected',
      lastError,
    };
  }

  private async disconnectSession(id: string): Promise<void> {
    const session = this.activeSessions.get(id);
    if (!session) return;

    this.activeSessions.delete(id);
    await this.safeDisconnectClient(session.client);
    this.log('system', `Disconnected remote session "${session.connection.name}"`);
  }

  private async safeDisconnectClient(client: RemoteTransportClient): Promise<void> {
    try {
      await client.disconnect();
    } catch (error) {
      const message = this.getErrorMessage(error);
      if (!this.shouldIgnoreDisconnectError(message)) {
        this.log('warning', `Remote disconnect cleanup warning: ${message}`);
      }
    }
  }

  private shouldIgnoreDisconnectError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('not connected') ||
      normalized.includes('closed') ||
      normalized.includes('end called') ||
      normalized.includes('no sftp connection available')
    );
  }

  private assertSecretCodecAvailable(): void {
    if (!this.secretCodec.isAvailable()) {
      throw new Error('OS-backed secret storage is unavailable');
    }
  }

  private setLastError(connectionId: string, error: string): void {
    this.lastErrors.set(connectionId, error);
  }

  private clearLastError(connectionId: string): void {
    this.lastErrors.delete(connectionId);
  }

  private createConnectionId(): string {
    return `remote-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private async runWithTimeout<T>(
    timeoutMessage: string,
    operation: () => Promise<T>,
    onTimeout: () => Promise<void>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        void onTimeout().finally(() => {
          reject(new Error(timeoutMessage));
        });
      }, this.connectTimeoutMs);

      void operation()
        .then((result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private log(level: string, message: string): void {
    this.processBridge.broadcastLog(level, `[remote] ${message}`);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
