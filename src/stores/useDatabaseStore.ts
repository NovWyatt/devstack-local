/**
 * Database store (Zustand)
 *
 * Handles MySQL database CRUD/import/export and safe table browsing via Electron IPC.
 */

import { create } from 'zustand';
import type {
  DatabaseListResult,
  DatabaseOperationResult,
  DatabaseQueryResult,
  DatabaseTableListResult,
  DatabaseTableRow,
  DatabaseTableRowsResult,
  DatabaseTableSchemaColumn,
  DatabaseTableSchemaResult,
} from '../types/database.types';

const DEFAULT_ROWS_LIMIT = 50;

interface DatabaseStore {
  databases: string[];
  tables: string[];
  selectedDatabase: string | null;
  selectedTable: string | null;
  schemaColumns: DatabaseTableSchemaColumn[];
  rowColumns: string[];
  rows: DatabaseTableRow[];
  rowsPage: number;
  rowsLimit: number;
  rowsHasMore: boolean;
  loadingDatabases: boolean;
  creatingDatabase: boolean;
  deletingDatabase: string | null;
  importingDatabase: string | null;
  exportingDatabase: string | null;
  loadingTables: boolean;
  loadingSchema: boolean;
  loadingRows: boolean;
  runningQuery: boolean;
  browserError: string | null;
  queryResult: DatabaseQueryResult | null;
  queryError: string | null;

  fetchDatabases: () => Promise<DatabaseListResult>;
  selectDatabase: (name: string | null) => void;
  selectTable: (name: string | null) => void;
  fetchTables: (databaseName: string) => Promise<DatabaseTableListResult>;
  fetchTableSchema: (databaseName: string, tableName: string) => Promise<DatabaseTableSchemaResult>;
  fetchTableRows: (
    databaseName: string,
    tableName: string,
    page: number,
    limit: number
  ) => Promise<DatabaseTableRowsResult>;
  executeSqlQuery: (
    databaseName: string,
    sql: string,
    allowWrite?: boolean
  ) => Promise<DatabaseQueryResult>;
  clearSqlQueryState: () => void;
  createDatabase: (name: string) => Promise<DatabaseOperationResult>;
  deleteDatabase: (name: string) => Promise<DatabaseOperationResult>;
  importDatabase: (databaseName: string, filePath?: string) => Promise<DatabaseOperationResult>;
  exportDatabase: (databaseName: string, filePath?: string) => Promise<DatabaseOperationResult>;
}

function sortDatabases(databases: string[]): string[] {
  return [...databases].sort((a, b) => a.localeCompare(b));
}

function sortTables(tables: string[]): string[] {
  return [...tables].sort((a, b) => a.localeCompare(b));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useDatabaseStore = create<DatabaseStore>((set, get) => ({
  databases: [],
  tables: [],
  selectedDatabase: null,
  selectedTable: null,
  schemaColumns: [],
  rowColumns: [],
  rows: [],
  rowsPage: 1,
  rowsLimit: DEFAULT_ROWS_LIMIT,
  rowsHasMore: false,
  loadingDatabases: false,
  creatingDatabase: false,
  deletingDatabase: null,
  importingDatabase: null,
  exportingDatabase: null,
  loadingTables: false,
  loadingSchema: false,
  loadingRows: false,
  runningQuery: false,
  browserError: null,
  queryResult: null,
  queryError: null,

  fetchDatabases: async () => {
    set({ loadingDatabases: true });
    try {
      if (!window.electronAPI?.dbList) {
        const unavailable: DatabaseListResult = {
          success: false,
          message: 'Database API is unavailable outside Electron mode',
          error: 'IPC_UNAVAILABLE',
          databases: [],
        };
        set({
          loadingDatabases: false,
          databases: [],
          selectedDatabase: null,
          selectedTable: null,
          tables: [],
          schemaColumns: [],
          rowColumns: [],
          rows: [],
          rowsPage: 1,
          rowsHasMore: false,
          browserError: unavailable.message,
          queryResult: null,
          queryError: null,
        });
        return unavailable;
      }

      const result = await window.electronAPI.dbList();
      if (!result.success) {
        set({
          loadingDatabases: false,
          databases: [],
          selectedDatabase: null,
          selectedTable: null,
          tables: [],
          schemaColumns: [],
          rowColumns: [],
          rows: [],
          rowsPage: 1,
          rowsHasMore: false,
          browserError: result.error ?? result.message,
          queryResult: null,
          queryError: null,
        });
        return result;
      }

      const sortedDatabases = sortDatabases(result.databases);
      const currentSelectedDatabase = get().selectedDatabase;
      const nextSelectedDatabase =
        sortedDatabases.length === 0
          ? null
          : currentSelectedDatabase && sortedDatabases.includes(currentSelectedDatabase)
            ? currentSelectedDatabase
            : sortedDatabases[0];
      const selectionChanged = nextSelectedDatabase !== currentSelectedDatabase;

      set((state) => ({
        loadingDatabases: false,
        databases: sortedDatabases,
        selectedDatabase: nextSelectedDatabase,
        selectedTable: selectionChanged ? null : state.selectedTable,
        tables: selectionChanged ? [] : state.tables,
        schemaColumns: selectionChanged ? [] : state.schemaColumns,
        rowColumns: selectionChanged ? [] : state.rowColumns,
        rows: selectionChanged ? [] : state.rows,
        rowsPage: selectionChanged ? 1 : state.rowsPage,
        rowsHasMore: selectionChanged ? false : state.rowsHasMore,
        browserError: null,
      }));

      if (nextSelectedDatabase && selectionChanged) {
        await get().fetchTables(nextSelectedDatabase);
      }

      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({
        loadingDatabases: false,
        databases: [],
        selectedDatabase: null,
        selectedTable: null,
        tables: [],
        schemaColumns: [],
        rowColumns: [],
        rows: [],
        rowsPage: 1,
        rowsHasMore: false,
        browserError: message,
        queryResult: null,
        queryError: null,
      });
      return {
        success: false,
        message: 'Failed to load databases',
        error: message,
        databases: [],
      };
    }
  },

  selectDatabase: (name) => {
    set({
      selectedDatabase: name,
      selectedTable: null,
      tables: [],
      schemaColumns: [],
      rowColumns: [],
      rows: [],
      rowsPage: 1,
      rowsHasMore: false,
      browserError: null,
    });
  },

  selectTable: (name) => {
    set({
      selectedTable: name,
      schemaColumns: [],
      rowColumns: [],
      rows: [],
      rowsPage: 1,
      rowsHasMore: false,
      browserError: null,
    });
  },

  fetchTables: async (databaseName) => {
    if (!window.electronAPI?.dbTables) {
      const unavailable: DatabaseTableListResult = {
        success: false,
        message: 'Database table browser is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
        database: databaseName,
        tables: [],
      };
      set({
        loadingTables: false,
        selectedDatabase: databaseName || null,
        selectedTable: null,
        tables: [],
        schemaColumns: [],
        rowColumns: [],
        rows: [],
        rowsPage: 1,
        rowsHasMore: false,
        browserError: unavailable.message,
      });
      return unavailable;
    }

    const normalizedDatabaseName = databaseName.trim();
    if (!normalizedDatabaseName) {
      const invalid: DatabaseTableListResult = {
        success: false,
        message: 'Database name is required',
        error: 'INVALID_DATABASE',
        database: databaseName,
        tables: [],
      };
      set({
        loadingTables: false,
        selectedTable: null,
        tables: [],
        schemaColumns: [],
        rowColumns: [],
        rows: [],
        rowsPage: 1,
        rowsHasMore: false,
        browserError: invalid.message,
      });
      return invalid;
    }

    set({ loadingTables: true, browserError: null });
    try {
      const result = await window.electronAPI.dbTables(normalizedDatabaseName);
      if (!result.success) {
        set({
          loadingTables: false,
          selectedDatabase: normalizedDatabaseName,
          selectedTable: null,
          tables: [],
          schemaColumns: [],
          rowColumns: [],
          rows: [],
          rowsPage: 1,
          rowsHasMore: false,
          browserError: result.error ?? result.message,
        });
        return result;
      }

      const sortedTables = sortTables(result.tables);
      const currentSelectedTable = get().selectedTable;
      const nextSelectedTable =
        sortedTables.length === 0
          ? null
          : currentSelectedTable && sortedTables.includes(currentSelectedTable)
            ? currentSelectedTable
            : sortedTables[0];
      const tableSelectionChanged = nextSelectedTable !== currentSelectedTable;

      set((state) => ({
        loadingTables: false,
        selectedDatabase: normalizedDatabaseName,
        tables: sortedTables,
        selectedTable: nextSelectedTable,
        schemaColumns: tableSelectionChanged ? [] : state.schemaColumns,
        rowColumns: tableSelectionChanged ? [] : state.rowColumns,
        rows: tableSelectionChanged ? [] : state.rows,
        rowsPage: tableSelectionChanged ? 1 : state.rowsPage,
        rowsHasMore: tableSelectionChanged ? false : state.rowsHasMore,
        browserError: null,
      }));

      if (nextSelectedTable) {
        await get().fetchTableSchema(normalizedDatabaseName, nextSelectedTable);
        await get().fetchTableRows(
          normalizedDatabaseName,
          nextSelectedTable,
          1,
          get().rowsLimit
        );
      }

      return {
        ...result,
        database: normalizedDatabaseName,
        tables: sortedTables,
      };
    } catch (error) {
      const message = getErrorMessage(error);
      const failed: DatabaseTableListResult = {
        success: false,
        message: 'Failed to load tables',
        error: message,
        database: normalizedDatabaseName,
        tables: [],
      };
      set({
        loadingTables: false,
        selectedDatabase: normalizedDatabaseName,
        selectedTable: null,
        tables: [],
        schemaColumns: [],
        rowColumns: [],
        rows: [],
        rowsPage: 1,
        rowsHasMore: false,
        browserError: message,
      });
      return failed;
    }
  },

  fetchTableSchema: async (databaseName, tableName) => {
    if (!window.electronAPI?.dbSchema) {
      const unavailable: DatabaseTableSchemaResult = {
        success: false,
        message: 'Database table browser is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
        database: databaseName,
        table: tableName,
        columns: [],
      };
      set({
        loadingSchema: false,
        schemaColumns: [],
        browserError: unavailable.message,
      });
      return unavailable;
    }

    set({ loadingSchema: true, browserError: null });
    try {
      const result = await window.electronAPI.dbSchema(databaseName, tableName);
      if (!result.success) {
        set({
          loadingSchema: false,
          schemaColumns: [],
          browserError: result.error ?? result.message,
        });
        return result;
      }

      set({
        loadingSchema: false,
        schemaColumns: result.columns,
        browserError: null,
      });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      const failed: DatabaseTableSchemaResult = {
        success: false,
        message: 'Failed to load table schema',
        error: message,
        database: databaseName,
        table: tableName,
        columns: [],
      };
      set({
        loadingSchema: false,
        schemaColumns: [],
        browserError: message,
      });
      return failed;
    }
  },

  fetchTableRows: async (databaseName, tableName, page, limit) => {
    if (!window.electronAPI?.dbRows) {
      const unavailable: DatabaseTableRowsResult = {
        success: false,
        message: 'Database table browser is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
        database: databaseName,
        table: tableName,
        page,
        limit,
        hasMore: false,
        columns: [],
        rows: [],
      };
      set({
        loadingRows: false,
        rowColumns: [],
        rows: [],
        rowsHasMore: false,
        browserError: unavailable.message,
      });
      return unavailable;
    }

    set({ loadingRows: true, browserError: null });
    try {
      const result = await window.electronAPI.dbRows(databaseName, tableName, page, limit);
      if (!result.success) {
        set({
          loadingRows: false,
          rowColumns: [],
          rows: [],
          rowsPage: page,
          rowsLimit: limit,
          rowsHasMore: false,
          browserError: result.error ?? result.message,
        });
        return result;
      }

      set({
        loadingRows: false,
        rowColumns: result.columns,
        rows: result.rows,
        rowsPage: result.page,
        rowsLimit: result.limit,
        rowsHasMore: result.hasMore,
        browserError: null,
      });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      const failed: DatabaseTableRowsResult = {
        success: false,
        message: 'Failed to load table rows',
        error: message,
        database: databaseName,
        table: tableName,
        page,
        limit,
        hasMore: false,
        columns: [],
        rows: [],
      };
      set({
        loadingRows: false,
        rowColumns: [],
        rows: [],
        rowsPage: page,
        rowsLimit: limit,
        rowsHasMore: false,
        browserError: message,
      });
      return failed;
    }
  },

  executeSqlQuery: async (databaseName, sql, allowWrite = false) => {
    const normalizedDatabaseName = databaseName.trim();
    const normalizedSql = sql.trim();
    if (!normalizedDatabaseName) {
      const invalid: DatabaseQueryResult = {
        success: false,
        message: 'Database name is required',
        error: 'INVALID_DATABASE',
        database: databaseName,
        sql,
        queryType: 'unknown',
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: null,
        truncated: false,
      };
      set({ queryResult: null, queryError: invalid.message });
      return invalid;
    }

    if (!normalizedSql) {
      const invalid: DatabaseQueryResult = {
        success: false,
        message: 'SQL query is required',
        error: 'EMPTY_QUERY',
        database: normalizedDatabaseName,
        sql,
        queryType: 'unknown',
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: null,
        truncated: false,
      };
      set({ queryResult: null, queryError: invalid.message });
      return invalid;
    }

    if (!window.electronAPI?.dbQuery) {
      const unavailable: DatabaseQueryResult = {
        success: false,
        message: 'Database query console is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
        database: normalizedDatabaseName,
        sql,
        queryType: 'unknown',
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: null,
        truncated: false,
      };
      set({ queryResult: null, queryError: unavailable.message });
      return unavailable;
    }

    set({ runningQuery: true, queryError: null });
    try {
      const result = await window.electronAPI.dbQuery(normalizedDatabaseName, sql, allowWrite);
      if (!result.success) {
        set({
          runningQuery: false,
          queryResult: null,
          queryError: result.error ?? result.message,
        });
        return result;
      }

      set({
        runningQuery: false,
        queryResult: result,
        queryError: null,
      });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      const failed: DatabaseQueryResult = {
        success: false,
        message: 'Failed to execute SQL query',
        error: message,
        database: normalizedDatabaseName,
        sql,
        queryType: 'unknown',
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: null,
        truncated: false,
      };
      set({
        runningQuery: false,
        queryResult: null,
        queryError: message,
      });
      return failed;
    }
  },

  clearSqlQueryState: () => {
    set({
      queryResult: null,
      queryError: null,
    });
  },

  createDatabase: async (name: string) => {
    if (!window.electronAPI?.dbCreate) {
      return {
        success: false,
        message: 'Database API is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
      };
    }

    set({ creatingDatabase: true });
    try {
      const result = await window.electronAPI.dbCreate(name);
      if (result.success) {
        await get().fetchDatabases();
      }
      set({ creatingDatabase: false });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ creatingDatabase: false });
      return {
        success: false,
        message: 'Failed to create database',
        error: message,
      };
    }
  },

  deleteDatabase: async (name: string) => {
    if (!window.electronAPI?.dbDelete) {
      return {
        success: false,
        message: 'Database API is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
      };
    }

    set({ deletingDatabase: name });
    try {
      const result = await window.electronAPI.dbDelete(name);
      if (result.success) {
        await get().fetchDatabases();
      }
      set({ deletingDatabase: null });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ deletingDatabase: null });
      return {
        success: false,
        message: 'Failed to delete database',
        error: message,
      };
    }
  },

  importDatabase: async (databaseName: string, filePath?: string) => {
    if (!window.electronAPI?.dbImport) {
      return {
        success: false,
        message: 'Database API is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
      };
    }

    set({ importingDatabase: databaseName });
    try {
      const result = await window.electronAPI.dbImport(databaseName, filePath);
      if (result.success && get().selectedDatabase === databaseName) {
        await get().fetchTables(databaseName);
      }
      set({ importingDatabase: null });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ importingDatabase: null });
      return {
        success: false,
        message: 'Failed to import SQL file',
        error: message,
      };
    }
  },

  exportDatabase: async (databaseName: string, filePath?: string) => {
    if (!window.electronAPI?.dbExport) {
      return {
        success: false,
        message: 'Database API is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
      };
    }

    set({ exportingDatabase: databaseName });
    try {
      const result = await window.electronAPI.dbExport(databaseName, filePath);
      set({ exportingDatabase: null });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ exportingDatabase: null });
      return {
        success: false,
        message: 'Failed to export database',
        error: message,
      };
    }
  },
}));
