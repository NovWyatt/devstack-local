/**
 * Database store (Zustand)
 *
 * Handles MySQL database CRUD/import/export actions via Electron IPC.
 */

import { create } from 'zustand';
import type { DatabaseListResult, DatabaseOperationResult } from '../types/database.types';

interface DatabaseStore {
  databases: string[];
  loadingDatabases: boolean;
  creatingDatabase: boolean;
  deletingDatabase: string | null;
  importingDatabase: string | null;
  exportingDatabase: string | null;

  fetchDatabases: () => Promise<DatabaseListResult>;
  createDatabase: (name: string) => Promise<DatabaseOperationResult>;
  deleteDatabase: (name: string) => Promise<DatabaseOperationResult>;
  importDatabase: (databaseName: string, filePath?: string) => Promise<DatabaseOperationResult>;
  exportDatabase: (databaseName: string, filePath?: string) => Promise<DatabaseOperationResult>;
}

function sortDatabases(databases: string[]): string[] {
  return [...databases].sort((a, b) => a.localeCompare(b));
}

export const useDatabaseStore = create<DatabaseStore>((set, get) => ({
  databases: [],
  loadingDatabases: false,
  creatingDatabase: false,
  deletingDatabase: null,
  importingDatabase: null,
  exportingDatabase: null,

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
        set({ loadingDatabases: false, databases: [] });
        return unavailable;
      }

      const result = await window.electronAPI.dbList();
      set({
        loadingDatabases: false,
        databases: result.success ? sortDatabases(result.databases) : [],
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ loadingDatabases: false });
      return {
        success: false,
        message: 'Failed to load databases',
        error: message,
        databases: [],
      };
    }
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
      const message = error instanceof Error ? error.message : String(error);
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
      const message = error instanceof Error ? error.message : String(error);
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
      set({ importingDatabase: null });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
      const message = error instanceof Error ? error.message : String(error);
      set({ exportingDatabase: null });
      return {
        success: false,
        message: 'Failed to export database',
        error: message,
      };
    }
  },
}));
