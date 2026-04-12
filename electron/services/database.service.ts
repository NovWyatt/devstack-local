/**
 * DatabaseService
 *
 * Provides safe local MySQL database management operations:
 * - list databases
 * - create database
 * - delete database
 * - import .sql
 * - export .sql
 */

import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import type { ServiceState } from '../../src/types';
import type { DatabaseListResult, DatabaseOperationResult } from '../../src/types/database.types';
import { assertExecutable } from '../utils/binary.util';
import { ConfigStore } from '../utils/config.store';
import { ensureDir, getBundledBinaryRoots, getRuntimeRoot } from '../utils/runtime.paths';

interface DatabaseProcessBridge {
  broadcastLog(level: string, message: string): void;
  getServiceStatus(service: 'mysql'): ServiceState;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

const MYSQL_EXEC_TIMEOUT_MS = 30000;
const MYSQL_IMPORT_TIMEOUT_MS = 180000;
const MYSQL_DUMP_TIMEOUT_MS = 180000;
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

export class DatabaseService {
  private processBridge: DatabaseProcessBridge;

  constructor(processBridge: DatabaseProcessBridge) {
    this.processBridge = processBridge;
  }

  async listDatabases(): Promise<DatabaseListResult> {
    try {
      this.ensureMysqlRunning();

      const mysqlPath = this.resolveMysqlToolPath('mysql.exe');
      if (!mysqlPath) {
        throw new Error('MySQL client (mysql.exe) not found');
      }
      assertExecutable(mysqlPath, 'MySQL client');

      const { stdout } = await this.execFileCommand(
        mysqlPath,
        [...this.buildMysqlConnectionArgs(), '--batch', '--skip-column-names', '--execute', 'SHOW DATABASES;'],
        MYSQL_EXEC_TIMEOUT_MS
      );

      const databases = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .sort((a, b) => a.localeCompare(b));

      this.log('system', `Listed ${databases.length} databases`);
      return {
        success: true,
        message: 'Databases loaded',
        databases,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to list databases: ${message}`);
      return {
        success: false,
        message: 'Failed to load databases',
        error: message,
        databases: [],
      };
    }
  }

  async createDatabase(name: string): Promise<DatabaseOperationResult> {
    try {
      this.ensureMysqlRunning();
      const databaseName = this.validateDatabaseName(name, { allowSystem: false });

      const mysqlPath = this.resolveMysqlToolPath('mysql.exe');
      if (!mysqlPath) {
        throw new Error('MySQL client (mysql.exe) not found');
      }
      assertExecutable(mysqlPath, 'MySQL client');

      await this.execFileCommand(
        mysqlPath,
        [
          ...this.buildMysqlConnectionArgs(),
          '--execute',
          `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
        ],
        MYSQL_EXEC_TIMEOUT_MS
      );

      this.log('success', `Created database ${databaseName}`);
      return {
        success: true,
        message: `Database "${databaseName}" created successfully`,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to create database: ${message}`);
      return {
        success: false,
        message: 'Failed to create database',
        error: message,
      };
    }
  }

  async deleteDatabase(name: string): Promise<DatabaseOperationResult> {
    try {
      this.ensureMysqlRunning();
      const databaseName = this.validateDatabaseName(name, { allowSystem: false });

      const mysqlPath = this.resolveMysqlToolPath('mysql.exe');
      if (!mysqlPath) {
        throw new Error('MySQL client (mysql.exe) not found');
      }
      assertExecutable(mysqlPath, 'MySQL client');

      await this.execFileCommand(
        mysqlPath,
        [...this.buildMysqlConnectionArgs(), '--execute', `DROP DATABASE IF EXISTS \`${databaseName}\`;`],
        MYSQL_EXEC_TIMEOUT_MS
      );

      this.log('success', `Deleted database ${databaseName}`);
      return {
        success: true,
        message: `Database "${databaseName}" deleted successfully`,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to delete database: ${message}`);
      return {
        success: false,
        message: 'Failed to delete database',
        error: message,
      };
    }
  }

  async exportDatabase(name: string, outputPath?: string): Promise<DatabaseOperationResult> {
    try {
      this.ensureMysqlRunning();
      const databaseName = this.validateDatabaseName(name, { allowSystem: true });

      const mysqldumpPath = this.resolveMysqlToolPath('mysqldump.exe');
      if (!mysqldumpPath) {
        throw new Error('MySQL dump tool (mysqldump.exe) not found');
      }
      assertExecutable(mysqldumpPath, 'MySQL dump');

      const destinationPath = this.resolveExportPath(databaseName, outputPath);
      ensureDir(path.dirname(destinationPath));

      await this.spawnDumpCommand(mysqldumpPath, databaseName, destinationPath);

      this.log('success', `Exported ${databaseName} to ${destinationPath}`);
      return {
        success: true,
        message: `Database "${databaseName}" exported successfully`,
        filePath: destinationPath,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to export database: ${message}`);
      return {
        success: false,
        message: 'Failed to export database',
        error: message,
      };
    }
  }

  async importSqlFile(databaseNameRaw: string, sqlFilePath: string): Promise<DatabaseOperationResult> {
    try {
      this.ensureMysqlRunning();
      const databaseName = this.validateDatabaseName(databaseNameRaw, { allowSystem: false });
      const resolvedPath = this.validateSqlFilePath(sqlFilePath);

      const mysqlPath = this.resolveMysqlToolPath('mysql.exe');
      if (!mysqlPath) {
        throw new Error('MySQL client (mysql.exe) not found');
      }
      assertExecutable(mysqlPath, 'MySQL client');

      await this.spawnImportCommand(mysqlPath, databaseName, resolvedPath);

      this.log('success', `Imported SQL file into ${databaseName}: ${resolvedPath}`);
      return {
        success: true,
        message: `Imported SQL into "${databaseName}" successfully`,
        filePath: resolvedPath,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to import database: ${message}`);
      return {
        success: false,
        message: 'Failed to import SQL file',
        error: message,
      };
    }
  }

  private ensureMysqlRunning(): void {
    const mysqlState = this.processBridge.getServiceStatus('mysql');
    if (mysqlState.status !== 'running') {
      throw new Error('MySQL is not running. Start MySQL before managing databases.');
    }
  }

  private getMysqlPort(): number {
    return ConfigStore.getPort('mysql');
  }

  private buildMysqlConnectionArgs(): string[] {
    return [
      '--protocol=TCP',
      '--host=127.0.0.1',
      `--port=${this.getMysqlPort()}`,
      '--user=root',
      '--default-character-set=utf8mb4',
    ];
  }

  private resolveMysqlToolPath(toolName: 'mysql.exe' | 'mysqldump.exe'): string | null {
    const configuredBase = ConfigStore.getBinaryPath('mysql');
    if (configuredBase) {
      const configuredPath = path.join(configuredBase, 'bin', toolName);
      if (fs.existsSync(configuredPath)) {
        return configuredPath;
      }
    }

    for (const root of getBundledBinaryRoots()) {
      const bundledPath = path.join(root, 'mysql', 'bin', toolName);
      if (fs.existsSync(bundledPath)) {
        return bundledPath;
      }
    }

    const fallbackPaths = [
      path.join('C:\\MySQL', 'bin', toolName),
      path.join('C:\\Program Files\\MySQL\\MySQL Server 8.0', 'bin', toolName),
      path.join('C:\\devstack\\mysql', 'bin', toolName),
    ];

    for (const fallbackPath of fallbackPaths) {
      if (fs.existsSync(fallbackPath)) {
        return fallbackPath;
      }
    }

    return null;
  }

  private validateDatabaseName(
    value: string,
    options: { allowSystem: boolean }
  ): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new Error('Database name is required');
    }
    if (!DATABASE_NAME_PATTERN.test(normalized)) {
      throw new Error('Database name may only contain letters, numbers, and underscores');
    }

    const lowered = normalized.toLowerCase();
    if (!options.allowSystem && SYSTEM_DATABASES.has(lowered)) {
      throw new Error(`"${normalized}" is a protected system database`);
    }

    return normalized;
  }

  private validateSqlFilePath(sqlFilePath: string): string {
    const resolvedPath = path.resolve(sqlFilePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`SQL file not found: ${resolvedPath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`SQL path is not a file: ${resolvedPath}`);
    }

    if (path.extname(resolvedPath).toLowerCase() !== '.sql') {
      throw new Error('Only .sql files are supported for import');
    }

    return resolvedPath;
  }

  private resolveExportPath(databaseName: string, outputPath?: string): string {
    if (outputPath && outputPath.trim()) {
      const resolvedPath = path.resolve(outputPath);
      if (path.extname(resolvedPath).toLowerCase() === '.sql') {
        return resolvedPath;
      }
      return `${resolvedPath}.sql`;
    }

    const exportDir = ensureDir(path.join(getRuntimeRoot(), 'mysql', 'exports'));
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '-')
      .slice(0, 15);

    return path.join(exportDir, `${databaseName}-${timestamp}.sql`);
  }

  private async execFileCommand(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      execFile(command, args, { windowsHide: true, timeout: timeoutMs }, (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          reject(new Error(detail));
          return;
        }

        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      });
    });
  }

  private async spawnDumpCommand(
    mysqldumpPath: string,
    databaseName: string,
    destinationPath: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [
        ...this.buildMysqlConnectionArgs(),
        '--routines',
        '--events',
        '--triggers',
        '--single-transaction',
        '--skip-lock-tables',
        databaseName,
      ];

      const child = spawn(mysqldumpPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const writer = fs.createWriteStream(destinationPath, { encoding: 'utf-8' });
      let stderr = '';
      let finished = false;

      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        child.kill();
        writer.close();
        reject(new Error('MySQL export timed out'));
      }, MYSQL_DUMP_TIMEOUT_MS);

      child.stdout.pipe(writer);

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const fail = (error: Error): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        writer.destroy();
        try {
          if (fs.existsSync(destinationPath)) {
            fs.unlinkSync(destinationPath);
          }
        } catch {
          // Ignore cleanup errors.
        }
        reject(error);
      };

      child.once('error', (error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });

      writer.once('error', (error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });

      child.once('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        writer.end(() => {
          if (code !== 0) {
            const detail = stderr.trim() || `mysqldump exited with code ${code}`;
            try {
              if (fs.existsSync(destinationPath)) {
                fs.unlinkSync(destinationPath);
              }
            } catch {
              // Ignore cleanup errors.
            }
            reject(new Error(detail));
            return;
          }
          resolve();
        });
      });
    });
  }

  private async spawnImportCommand(
    mysqlPath: string,
    databaseName: string,
    sqlFilePath: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [...this.buildMysqlConnectionArgs(), databaseName];
      const child = spawn(mysqlPath, args, {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe'],
      });

      const reader = fs.createReadStream(sqlFilePath);
      let stderr = '';
      let finished = false;

      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        child.kill();
        reader.destroy();
        reject(new Error('MySQL import timed out'));
      }, MYSQL_IMPORT_TIMEOUT_MS);

      const fail = (error: Error): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        reader.destroy();
        reject(error);
      };

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      reader.once('error', (error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });

      child.once('error', (error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });

      child.stdin.on('error', (error) => {
        const streamError = error as NodeJS.ErrnoException;
        if (streamError.code === 'EPIPE' || streamError.code === 'ERR_STREAM_DESTROYED') {
          return;
        }
        fail(streamError instanceof Error ? streamError : new Error(String(streamError)));
      });

      child.once('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (code !== 0) {
          const detail = stderr.trim() || `mysql exited with code ${code}`;
          reject(new Error(detail));
          return;
        }
        resolve();
      });

      reader.pipe(child.stdin);
    });
  }

  private log(level: string, message: string): void {
    this.processBridge.broadcastLog(level, `[database] ${message}`);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
