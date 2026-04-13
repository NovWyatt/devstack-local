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
import type {
  DatabaseListResult,
  DatabaseOperationResult,
  DatabaseQueryResult,
  DatabaseQueryType,
  DatabaseTableListResult,
  DatabaseTableRow,
  DatabaseTableRowsResult,
  DatabaseTableSchemaResult,
} from '../../src/types/database.types';
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

interface ExecCommandOptions {
  signal?: AbortSignal;
  timeoutErrorMessage?: string;
}

const MYSQL_EXEC_TIMEOUT_MS = 30000;
const MYSQL_IMPORT_TIMEOUT_MS = 180000;
const MYSQL_DUMP_TIMEOUT_MS = 180000;
const MYSQL_QUERY_TIMEOUT_MS = 15000;
const MYSQL_ROW_FETCH_TIMEOUT_MS = 15000;
const MYSQL_CSV_EXPORT_TIMEOUT_MS = 60000;
const MYSQL_READ_MAX_EXECUTION_MS = 12000;
const MYSQL_IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;
const TABLE_BROWSE_MAX_LIMIT = 200;
const TABLE_BROWSE_DEFAULT_LIMIT = 50;
const QUERY_RESULT_MAX_ROWS = 500;
const EXEC_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const QUERY_MAX_BUFFER_BYTES = 25 * 1024 * 1024;
const CSV_EXPORT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const SQL_QUERY_MAX_LENGTH = 50000;
const ROW_FETCH_CANCELLED_ERROR = 'ROW_FETCH_CANCELLED';
const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
const READ_QUERY_TYPES = new Set<DatabaseQueryType>(['select', 'show', 'describe', 'explain']);
const WRITE_QUERY_TYPES = new Set<DatabaseQueryType>(['insert', 'update', 'delete']);

export class DatabaseService {
  private processBridge: DatabaseProcessBridge;
  private activeRowsFetchAbortController: AbortController | null = null;
  private rowsFetchGeneration = 0;

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

  async listTables(databaseRaw: string): Promise<DatabaseTableListResult> {
    const fallbackDatabase = databaseRaw.trim();

    try {
      this.ensureMysqlRunning();
      const databaseName = this.validateDatabaseName(databaseRaw, { allowSystem: true });

      const mysqlPath = this.resolveMysqlToolPath('mysql.exe');
      if (!mysqlPath) {
        throw new Error('MySQL client (mysql.exe) not found');
      }
      assertExecutable(mysqlPath, 'MySQL client');

      const { stdout } = await this.execFileCommand(
        mysqlPath,
        [
          ...this.buildMysqlConnectionArgs(),
          '--batch',
          '--skip-column-names',
          '--execute',
          `SHOW TABLES FROM \`${databaseName}\`;`,
        ],
        MYSQL_EXEC_TIMEOUT_MS
      );

      const tables = this.parseMysqlBatchLines(stdout)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .sort((a, b) => a.localeCompare(b));

      this.log('system', `Listed ${tables.length} tables in ${databaseName}`);
      return {
        success: true,
        message: 'Tables loaded',
        database: databaseName,
        tables,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to list tables: ${message}`);
      return {
        success: false,
        message: 'Failed to load tables',
        error: message,
        database: fallbackDatabase,
        tables: [],
      };
    }
  }

  async getTableSchema(databaseRaw: string, tableRaw: string): Promise<DatabaseTableSchemaResult> {
    const fallbackDatabase = databaseRaw.trim();
    const fallbackTable = tableRaw.trim();

    try {
      this.ensureMysqlRunning();
      const databaseName = this.validateDatabaseName(databaseRaw, { allowSystem: true });
      const tableName = this.validateTableName(tableRaw);

      const mysqlPath = this.resolveMysqlToolPath('mysql.exe');
      if (!mysqlPath) {
        throw new Error('MySQL client (mysql.exe) not found');
      }
      assertExecutable(mysqlPath, 'MySQL client');

      const { stdout } = await this.execFileCommand(
        mysqlPath,
        [
          ...this.buildMysqlConnectionArgs(),
          '--batch',
          '--skip-column-names',
          '--execute',
          `DESCRIBE \`${databaseName}\`.\`${tableName}\`;`,
        ],
        MYSQL_EXEC_TIMEOUT_MS
      );

      const columns = this.parseMysqlBatchLines(stdout)
        .map((line) => line.split('\t'))
        .filter((parts) => parts.length > 0 && parts[0].trim().length > 0)
        .map((parts) => {
          const field = parts[0] ?? '';
          const type = parts[1] ?? '';
          const nullValue = parts[2] ?? '';
          const key = parts[3] ?? '';
          const defaultValueRaw = parts[4] ?? '';
          const extra = parts[5] ?? '';

          return {
            field,
            type,
            nullable: nullValue.toUpperCase() === 'YES',
            key,
            defaultValue:
              defaultValueRaw === '\\N' || defaultValueRaw.toUpperCase() === 'NULL'
                ? null
                : defaultValueRaw,
            extra,
          };
        });

      this.log('system', `Loaded schema for ${databaseName}.${tableName}`);
      return {
        success: true,
        message: 'Schema loaded',
        database: databaseName,
        table: tableName,
        columns,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to load schema: ${message}`);
      return {
        success: false,
        message: 'Failed to load table schema',
        error: message,
        database: fallbackDatabase,
        table: fallbackTable,
        columns: [],
      };
    }
  }

  async getTableRows(
    databaseRaw: string,
    tableRaw: string,
    pageRaw: number,
    limitRaw: number
  ): Promise<DatabaseTableRowsResult> {
    const fallbackDatabase = databaseRaw.trim();
    const fallbackTable = tableRaw.trim();
    const fallbackPage = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
    const fallbackLimit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.floor(limitRaw))
      : TABLE_BROWSE_DEFAULT_LIMIT;
    const fetchGeneration = this.rowsFetchGeneration + 1;
    this.rowsFetchGeneration = fetchGeneration;

    if (this.activeRowsFetchAbortController) {
      this.activeRowsFetchAbortController.abort();
    }
    const fetchAbortController = new AbortController();
    this.activeRowsFetchAbortController = fetchAbortController;

    try {
      this.ensureMysqlRunning();
      const databaseName = this.validateDatabaseName(databaseRaw, { allowSystem: true });
      const tableName = this.validateTableName(tableRaw);
      const page = this.normalizePage(pageRaw);
      const limit = this.normalizeLimit(limitRaw);
      const offset = (page - 1) * limit;
      const limitWithLookAhead = limit + 1;

      const mysqlPath = this.resolveMysqlToolPath('mysql.exe');
      if (!mysqlPath) {
        throw new Error('MySQL client (mysql.exe) not found');
      }
      assertExecutable(mysqlPath, 'MySQL client');

      const { stdout } = await this.execFileCommand(
        mysqlPath,
        [
          ...this.buildMysqlConnectionArgs(),
          '--batch',
          '--execute',
          `SELECT * FROM \`${databaseName}\`.\`${tableName}\` LIMIT ${limitWithLookAhead} OFFSET ${offset};`,
        ],
        MYSQL_ROW_FETCH_TIMEOUT_MS,
        EXEC_MAX_BUFFER_BYTES,
        {
          signal: fetchAbortController.signal,
          timeoutErrorMessage: `Row fetch timed out after ${Math.floor(MYSQL_ROW_FETCH_TIMEOUT_MS / 1000)}s`,
        }
      );

      if (fetchGeneration !== this.rowsFetchGeneration) {
        this.log('warning', `Cancelled stale row fetch for ${databaseName}.${tableName}`);
        return {
          success: false,
          message: 'Row fetch cancelled',
          error: ROW_FETCH_CANCELLED_ERROR,
          database: databaseName,
          table: tableName,
          page,
          limit,
          hasMore: false,
          columns: [],
          rows: [],
        };
      }

      const lines = this.parseMysqlBatchLines(stdout);
      const columns = lines.length > 0 ? lines[0].split('\t') : [];
      const parsedRows = lines.slice(1).map((line) => this.parseTableRow(line, columns));
      const hasMore = parsedRows.length > limit;
      const rows = hasMore ? parsedRows.slice(0, limit) : parsedRows;

      this.log(
        'system',
        `Loaded ${rows.length} rows from ${databaseName}.${tableName} (page=${page}, limit=${limit})`
      );
      return {
        success: true,
        message: 'Rows loaded',
        database: databaseName,
        table: tableName,
        page,
        limit,
        hasMore,
        columns,
        rows,
      };
    } catch (error) {
      if (this.isAbortError(error) || fetchGeneration !== this.rowsFetchGeneration) {
        this.log('warning', `Cancelled stale row fetch for ${fallbackDatabase}.${fallbackTable}`);
        return {
          success: false,
          message: 'Row fetch cancelled',
          error: ROW_FETCH_CANCELLED_ERROR,
          database: fallbackDatabase,
          table: fallbackTable,
          page: fallbackPage,
          limit: fallbackLimit,
          hasMore: false,
          columns: [],
          rows: [],
        };
      }

      const message = this.getErrorMessage(error);
      this.log('error', `Failed to load rows: ${message}`);
      return {
        success: false,
        message: 'Failed to load table rows',
        error: message,
        database: fallbackDatabase,
        table: fallbackTable,
        page: fallbackPage,
        limit: fallbackLimit,
        hasMore: false,
        columns: [],
        rows: [],
      };
    } finally {
      if (this.activeRowsFetchAbortController === fetchAbortController) {
        this.activeRowsFetchAbortController = null;
      }
    }
  }

  async executeQuery(
    databaseRaw: string,
    sqlRaw: string,
    allowWriteRaw: boolean = false
  ): Promise<DatabaseQueryResult> {
    const fallbackDatabase = databaseRaw.trim();
    const fallbackSql = typeof sqlRaw === 'string' ? sqlRaw : '';

    try {
      this.ensureMysqlRunning();
      const databaseName = this.validateDatabaseName(databaseRaw, { allowSystem: true });
      const sql = this.normalizeSqlStatement(sqlRaw);
      const queryType = this.getQueryType(sql);

      this.assertSafeQuery(sql);
      this.assertQueryTypeSupported(queryType, allowWriteRaw);

      const mysqlPath = this.resolveMysqlToolPath('mysql.exe');
      if (!mysqlPath) {
        throw new Error('MySQL client (mysql.exe) not found');
      }
      assertExecutable(mysqlPath, 'MySQL client');

      if (WRITE_QUERY_TYPES.has(queryType)) {
        const writeSql = `${sql}; SELECT ROW_COUNT() AS affected_rows`;
        const { stdout } = await this.execFileCommand(
          mysqlPath,
          [...this.buildMysqlConnectionArgs(), '--batch', '--execute', writeSql, databaseName],
          MYSQL_QUERY_TIMEOUT_MS,
          QUERY_MAX_BUFFER_BYTES,
          {
            timeoutErrorMessage: `SQL write query timed out after ${Math.floor(MYSQL_QUERY_TIMEOUT_MS / 1000)}s`,
          }
        );

        const { columns, rows } = this.parseTabularResult(stdout);
        const affectedRows = this.parseAffectedRows(columns, rows);

        this.log('success', `Executed ${queryType.toUpperCase()} query on ${databaseName}`);
        return {
          success: true,
          message: `Query executed successfully (${affectedRows} rows affected)`,
          database: databaseName,
          sql,
          queryType,
          columns: [],
          rows: [],
          rowCount: 0,
          affectedRows,
          truncated: false,
        };
      }

      const executableReadSql = this.buildReadQuerySql(sql, queryType);
      const { stdout } = await this.execFileCommand(
        mysqlPath,
        [...this.buildMysqlConnectionArgs(), '--batch', '--execute', executableReadSql, databaseName],
        MYSQL_QUERY_TIMEOUT_MS,
        QUERY_MAX_BUFFER_BYTES,
        {
          timeoutErrorMessage: `SQL query timed out after ${Math.floor(MYSQL_QUERY_TIMEOUT_MS / 1000)}s`,
        }
      );

      const parsed = this.parseTabularResult(stdout);
      const hasOverflow = parsed.rows.length > QUERY_RESULT_MAX_ROWS;
      const rows = hasOverflow ? parsed.rows.slice(0, QUERY_RESULT_MAX_ROWS) : parsed.rows;

      this.log(
        'system',
        `Executed ${queryType.toUpperCase()} query on ${databaseName} (${rows.length} rows${hasOverflow ? ', truncated' : ''})`
      );
      return {
        success: true,
        message: hasOverflow
          ? `Query succeeded. Showing first ${QUERY_RESULT_MAX_ROWS} rows.`
          : 'Query succeeded.',
        database: databaseName,
        sql,
        queryType,
        columns: parsed.columns,
        rows,
        rowCount: rows.length,
        affectedRows: null,
        truncated: hasOverflow,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to execute query: ${message}`);
      return {
        success: false,
        message: 'Failed to execute SQL query',
        error: message,
        database: fallbackDatabase,
        sql: fallbackSql,
        queryType: 'unknown',
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: null,
        truncated: false,
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

  async exportTableToCsv(
    databaseNameRaw: string,
    tableNameRaw: string,
    outputPath?: string
  ): Promise<DatabaseOperationResult> {
    let destinationPath = '';

    try {
      this.ensureMysqlRunning();
      const databaseName = this.validateDatabaseName(databaseNameRaw, { allowSystem: true });
      const tableName = this.validateTableName(tableNameRaw);

      const mysqlPath = this.resolveMysqlToolPath('mysql.exe');
      if (!mysqlPath) {
        throw new Error('MySQL client (mysql.exe) not found');
      }
      assertExecutable(mysqlPath, 'MySQL client');

      destinationPath = this.resolveTableCsvExportPath(databaseName, tableName, outputPath);
      ensureDir(path.dirname(destinationPath));

      const { stdout } = await this.execFileCommand(
        mysqlPath,
        [
          ...this.buildMysqlConnectionArgs(),
          '--batch',
          '--execute',
          `SELECT * FROM \`${databaseName}\`.\`${tableName}\`;`,
        ],
        MYSQL_CSV_EXPORT_TIMEOUT_MS,
        CSV_EXPORT_MAX_BUFFER_BYTES,
        {
          timeoutErrorMessage: `CSV export timed out after ${Math.floor(MYSQL_CSV_EXPORT_TIMEOUT_MS / 1000)}s`,
        }
      );

      const parsed = this.parseTabularResult(stdout);
      const csvContent = this.buildCsvContent(parsed.columns, parsed.rows);
      fs.writeFileSync(destinationPath, csvContent, 'utf-8');

      this.log(
        'success',
        `Exported ${databaseName}.${tableName} to CSV (${parsed.rows.length} rows) at ${destinationPath}`
      );
      return {
        success: true,
        message: `Table "${databaseName}.${tableName}" exported to CSV (${parsed.rows.length} rows)`,
        filePath: destinationPath,
      };
    } catch (error) {
      if (destinationPath && fs.existsSync(destinationPath)) {
        try {
          fs.unlinkSync(destinationPath);
        } catch {
          // Ignore cleanup errors.
        }
      }

      const message = this.getErrorMessage(error);
      this.log('error', `Failed to export table CSV: ${message}`);
      return {
        success: false,
        message: 'Failed to export table CSV',
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
    if (!MYSQL_IDENTIFIER_PATTERN.test(normalized)) {
      throw new Error('Database name may only contain letters, numbers, and underscores');
    }

    const lowered = normalized.toLowerCase();
    if (!options.allowSystem && SYSTEM_DATABASES.has(lowered)) {
      throw new Error(`"${normalized}" is a protected system database`);
    }

    return normalized;
  }

  private validateTableName(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new Error('Table name is required');
    }
    if (!MYSQL_IDENTIFIER_PATTERN.test(normalized)) {
      throw new Error('Table name may only contain letters, numbers, and underscores');
    }
    return normalized;
  }

  private normalizePage(value: number): number {
    if (!Number.isFinite(value)) {
      throw new Error('Page must be a valid number');
    }

    const page = Math.floor(value);
    if (page < 1) {
      throw new Error('Page must be at least 1');
    }

    return page;
  }

  private normalizeLimit(value: number): number {
    if (!Number.isFinite(value)) {
      return TABLE_BROWSE_DEFAULT_LIMIT;
    }

    const limit = Math.floor(value);
    if (limit < 1) {
      throw new Error('Limit must be at least 1');
    }

    return Math.min(limit, TABLE_BROWSE_MAX_LIMIT);
  }

  private parseMysqlBatchLines(stdout: string): string[] {
    const normalized = stdout.replace(/\r\n/g, '\n');
    if (!normalized) {
      return [];
    }

    const withoutFinalNewline = normalized.endsWith('\n')
      ? normalized.slice(0, -1)
      : normalized;

    return withoutFinalNewline.length === 0 ? [''] : withoutFinalNewline.split('\n');
  }

  private parseTableRow(line: string, columns: string[]): DatabaseTableRow {
    const values = line.split('\t');
    const row: DatabaseTableRow = {};

    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      const rawValue = values[index] ?? '';
      row[column] = rawValue === '\\N' ? null : rawValue;
    }

    return row;
  }

  private normalizeSqlStatement(sqlRaw: string): string {
    const trimmed = sqlRaw.trim();
    if (!trimmed) {
      throw new Error('SQL query is required');
    }

    if (trimmed.length > SQL_QUERY_MAX_LENGTH) {
      throw new Error(`SQL query is too long (max ${SQL_QUERY_MAX_LENGTH} characters)`);
    }

    const withoutTrailingSemicolon = trimmed.replace(/;+\s*$/, '').trim();
    if (!withoutTrailingSemicolon) {
      throw new Error('SQL query is required');
    }

    if (withoutTrailingSemicolon.includes(';')) {
      throw new Error('Only a single SQL statement is allowed');
    }

    return withoutTrailingSemicolon;
  }

  private getQueryType(sql: string): DatabaseQueryType {
    const keywordMatch = sql.match(/^([A-Za-z]+)/);
    if (!keywordMatch) {
      return 'unknown';
    }

    const keyword = keywordMatch[1].toLowerCase();
    if (keyword === 'select') return 'select';
    if (keyword === 'show') return 'show';
    if (keyword === 'describe' || keyword === 'desc') return 'describe';
    if (keyword === 'explain') return 'explain';
    if (keyword === 'insert') return 'insert';
    if (keyword === 'update') return 'update';
    if (keyword === 'delete') return 'delete';
    return 'unknown';
  }

  private assertSafeQuery(sql: string): void {
    const normalized = sql.toUpperCase();
    if (/\bDROP\s+DATABASE\b/.test(normalized)) {
      throw new Error('DROP DATABASE is blocked in SQL Console');
    }
    if (/\bDROP\s+TABLE\b/.test(normalized)) {
      throw new Error('DROP TABLE is blocked in SQL Console');
    }
    if (/\bTRUNCATE\b/.test(normalized)) {
      throw new Error('TRUNCATE is blocked in SQL Console');
    }
  }

  private assertQueryTypeSupported(queryType: DatabaseQueryType, allowWrite: boolean): void {
    if (READ_QUERY_TYPES.has(queryType)) {
      return;
    }

    if (WRITE_QUERY_TYPES.has(queryType)) {
      if (!allowWrite) {
        throw new Error('Write query requires explicit confirmation (INSERT/UPDATE/DELETE)');
      }
      return;
    }

    throw new Error(
      'Only SELECT, SHOW, DESCRIBE, EXPLAIN, and confirmed INSERT/UPDATE/DELETE are allowed'
    );
  }

  private buildReadQuerySql(sql: string, queryType: DatabaseQueryType): string {
    if (queryType === 'select') {
      return `SELECT /*+ MAX_EXECUTION_TIME(${MYSQL_READ_MAX_EXECUTION_MS}) */ * FROM (${sql}) AS __devstack_query LIMIT ${QUERY_RESULT_MAX_ROWS + 1}`;
    }
    return sql;
  }

  private parseTabularResult(stdout: string): { columns: string[]; rows: DatabaseTableRow[] } {
    const lines = this.parseMysqlBatchLines(stdout);
    if (lines.length === 0) {
      return { columns: [], rows: [] };
    }

    const columns = lines[0].split('\t');
    if (columns.length === 1 && columns[0] === '') {
      return { columns: [], rows: [] };
    }

    const rows = lines.slice(1).map((line) => this.parseTableRow(line, columns));
    return { columns, rows };
  }

  private parseAffectedRows(columns: string[], rows: DatabaseTableRow[]): number {
    if (columns.length === 0 || rows.length === 0) {
      return 0;
    }

    const column = columns[0];
    const rawValue = rows[0][column];
    if (rawValue === null) {
      return 0;
    }

    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
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
      return this.sanitizeExportDestination(
        outputPath,
        '.sql',
        this.sanitizeFilenameSegment(databaseName, 'database')
      );
    }

    const exportDir = ensureDir(path.join(getRuntimeRoot(), 'mysql', 'exports'));
    const safeDatabaseName = this.sanitizeFilenameSegment(databaseName, 'database');
    return path.join(exportDir, `${safeDatabaseName}-${this.buildTimestampToken()}.sql`);
  }

  private resolveTableCsvExportPath(
    databaseName: string,
    tableName: string,
    outputPath?: string
  ): string {
    const safeDatabaseName = this.sanitizeFilenameSegment(databaseName, 'database');
    const safeTableName = this.sanitizeFilenameSegment(tableName, 'table');

    if (outputPath && outputPath.trim()) {
      return this.sanitizeExportDestination(
        outputPath,
        '.csv',
        `${safeDatabaseName}-${safeTableName}`
      );
    }

    const exportDir = ensureDir(path.join(getRuntimeRoot(), 'mysql', 'exports'));
    return path.join(
      exportDir,
      `${safeDatabaseName}-${safeTableName}-${this.buildTimestampToken()}.csv`
    );
  }

  private sanitizeExportDestination(
    rawPath: string,
    requiredExtension: '.sql' | '.csv',
    fallbackBaseName: string
  ): string {
    const resolvedPath = path.resolve(rawPath);
    const destinationDir = path.dirname(resolvedPath);
    const requestedName = path.parse(resolvedPath).name;
    const safeName = this.sanitizeFilenameSegment(requestedName, fallbackBaseName);
    return path.join(destinationDir, `${safeName}${requiredExtension}`);
  }

  private sanitizeFilenameSegment(value: string, fallback: string): string {
    const normalized = value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
    return normalized || fallback;
  }

  private buildTimestampToken(): string {
    return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  }

  private buildCsvContent(columns: string[], rows: DatabaseTableRow[]): string {
    if (columns.length === 0) {
      return '';
    }

    const header = columns.map((column) => this.encodeCsvCell(column)).join(',');
    const csvRows = rows.map((row) =>
      columns.map((column) => this.encodeCsvCell(row[column] ?? null)).join(',')
    );

    return [header, ...csvRows].join('\r\n');
  }

  private encodeCsvCell(value: string | null): string {
    const normalized = value === null ? '' : this.decodeMysqlBatchEscapes(value);
    const escaped = normalized.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private decodeMysqlBatchEscapes(value: string): string {
    return value.replace(/\\([0btnr\\])/g, (_match, token: string) => {
      if (token === '0') return '\0';
      if (token === 'b') return '\b';
      if (token === 't') return '\t';
      if (token === 'n') return '\n';
      if (token === 'r') return '\r';
      if (token === '\\') return '\\';
      return token;
    });
  }

  private async execFileCommand(
    command: string,
    args: string[],
    timeoutMs: number,
    maxBufferBytes: number = EXEC_MAX_BUFFER_BYTES,
    options: ExecCommandOptions = {}
  ): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      execFile(
        command,
        args,
        {
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: maxBufferBytes,
          signal: options.signal,
        },
        (error, stdout, stderr) => {
          if (error) {
            if (this.isTimeoutError(error)) {
              reject(
                new Error(
                  options.timeoutErrorMessage ??
                    `Command timed out after ${Math.floor(timeoutMs / 1000)}s`
                )
              );
              return;
            }

            if (this.isAbortError(error)) {
              reject(error);
              return;
            }

            const detail = stderr?.trim() || error.message;
            reject(new Error(detail));
            return;
          }

          resolve({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
          });
        }
      );
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

  private isTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const nodeError = error as NodeJS.ErrnoException & {
      killed?: boolean;
      signal?: NodeJS.Signals | null;
    };

    if (nodeError.code === 'ETIMEDOUT') {
      return true;
    }

    if (nodeError.killed && nodeError.signal === 'SIGTERM' && /timed out/i.test(nodeError.message)) {
      return true;
    }

    return /timed out/i.test(nodeError.message);
  }

  private isAbortError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const nodeError = error as NodeJS.ErrnoException;
    if (error.name === 'AbortError') {
      return true;
    }

    return nodeError.code === 'ABORT_ERR' || /aborted/i.test(error.message);
  }

  private log(level: string, message: string): void {
    this.processBridge.broadcastLog(level, `[database] ${message}`);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
