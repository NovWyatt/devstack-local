/**
 * Remote connection store (Zustand)
 *
 * Handles saved SFTP/FTP connections, connection testing,
 * connect/disconnect flows, and simple remote root previews.
 */

import { create } from 'zustand';
import type {
  RemoteConnectionConnectResult,
  RemoteConnectionInput,
  RemoteConnectionOperationResult,
  RemoteConnectionSummary,
  RemoteConnectionTestResult,
  RemoteDirectoryEntry,
  RemoteDirectoryListResult,
} from '../types/remote.types';

interface RemoteStore {
  connections: RemoteConnectionSummary[];
  selectedConnectionId: string | null;
  previewConnectionId: string | null;
  previewRootPath: string | null;
  previewEntries: RemoteDirectoryEntry[];
  loadingConnections: boolean;
  submittingConnection: boolean;
  deletingConnectionId: string | null;
  testingConnection: boolean;
  connectingConnectionId: string | null;
  disconnectingConnectionId: string | null;
  loadingPreviewConnectionId: string | null;
  pageError: string | null;

  fetchConnections: () => Promise<RemoteConnectionSummary[]>;
  selectConnection: (id: string | null) => void;
  createConnection: (payload: RemoteConnectionInput) => Promise<RemoteConnectionOperationResult>;
  updateConnection: (
    id: string,
    payload: RemoteConnectionInput
  ) => Promise<RemoteConnectionOperationResult>;
  deleteConnection: (id: string) => Promise<RemoteConnectionOperationResult>;
  testConnection: (
    payload: RemoteConnectionInput,
    existingConnectionId?: string
  ) => Promise<RemoteConnectionTestResult>;
  connectConnection: (id: string) => Promise<RemoteConnectionConnectResult>;
  disconnectConnection: (id: string) => Promise<RemoteConnectionOperationResult>;
  loadPreview: (id: string) => Promise<RemoteDirectoryListResult>;
  clearPreview: () => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getUnavailableMessage(): string {
  return 'Remote manager is unavailable outside Electron mode';
}

function pickNextSelection(
  currentId: string | null,
  connections: RemoteConnectionSummary[]
): string | null {
  if (connections.length === 0) {
    return null;
  }

  const existing = connections.find((item) => item.id === currentId);
  return existing ? existing.id : connections[0].id;
}

export const useRemoteStore = create<RemoteStore>((set, get) => ({
  connections: [],
  selectedConnectionId: null,
  previewConnectionId: null,
  previewRootPath: null,
  previewEntries: [],
  loadingConnections: false,
  submittingConnection: false,
  deletingConnectionId: null,
  testingConnection: false,
  connectingConnectionId: null,
  disconnectingConnectionId: null,
  loadingPreviewConnectionId: null,
  pageError: null,

  fetchConnections: async () => {
    if (!window.electronAPI?.remoteList) {
      set({
        connections: [],
        selectedConnectionId: null,
        previewConnectionId: null,
        previewRootPath: null,
        previewEntries: [],
        loadingConnections: false,
        pageError: getUnavailableMessage(),
      });
      return [];
    }

    set({ loadingConnections: true, pageError: null });
    try {
      const connections = await window.electronAPI.remoteList();
      const selectedConnectionId = pickNextSelection(get().selectedConnectionId, connections);
      const previewConnectionId = get().previewConnectionId;
      const previewConnection = connections.find((item) => item.id === previewConnectionId);

      set({
        connections,
        selectedConnectionId,
        previewConnectionId:
          previewConnection && previewConnection.status === 'connected'
            ? previewConnectionId
            : null,
        previewRootPath:
          previewConnection && previewConnection.status === 'connected'
            ? get().previewRootPath
            : null,
        previewEntries:
          previewConnection && previewConnection.status === 'connected'
            ? get().previewEntries
            : [],
        loadingConnections: false,
        pageError: null,
      });

      return connections;
    } catch (error) {
      const message = getErrorMessage(error);
      set({
        loadingConnections: false,
        pageError: message,
      });
      return [];
    }
  },

  selectConnection: (id) => {
    set({ selectedConnectionId: id });
  },

  createConnection: async (payload) => {
    if (!window.electronAPI?.remoteCreate) {
      return {
        success: false,
        message: getUnavailableMessage(),
        error: 'IPC_UNAVAILABLE',
      };
    }

    set({ submittingConnection: true });
    try {
      const result = await window.electronAPI.remoteCreate(payload);
      if (result.success) {
        const connections = await get().fetchConnections();
        const nextSelection = result.connection?.id ?? connections[0]?.id ?? null;
        set({ selectedConnectionId: nextSelection, submittingConnection: false });
      } else {
        set({ submittingConnection: false });
      }
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ submittingConnection: false });
      return { success: false, message: 'Failed to save connection', error: message };
    }
  },

  updateConnection: async (id, payload) => {
    if (!window.electronAPI?.remoteUpdate) {
      return {
        success: false,
        message: getUnavailableMessage(),
        error: 'IPC_UNAVAILABLE',
      };
    }

    set({ submittingConnection: true });
    try {
      const result = await window.electronAPI.remoteUpdate(id, payload);
      if (result.success) {
        await get().fetchConnections();
        if (get().previewConnectionId === id) {
          set({
            previewConnectionId: null,
            previewRootPath: null,
            previewEntries: [],
          });
        }
      }
      set({ submittingConnection: false });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ submittingConnection: false });
      return { success: false, message: 'Failed to update connection', error: message };
    }
  },

  deleteConnection: async (id) => {
    if (!window.electronAPI?.remoteDelete) {
      return {
        success: false,
        message: getUnavailableMessage(),
        error: 'IPC_UNAVAILABLE',
      };
    }

    set({ deletingConnectionId: id });
    try {
      const result = await window.electronAPI.remoteDelete(id);
      if (result.success) {
        await get().fetchConnections();
        if (get().previewConnectionId === id) {
          set({
            previewConnectionId: null,
            previewRootPath: null,
            previewEntries: [],
          });
        }
      }
      set({ deletingConnectionId: null });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ deletingConnectionId: null });
      return { success: false, message: 'Failed to delete connection', error: message };
    }
  },

  testConnection: async (payload, existingConnectionId) => {
    if (!window.electronAPI?.remoteTest) {
      return {
        success: false,
        message: getUnavailableMessage(),
        error: 'IPC_UNAVAILABLE',
        protocol: payload.protocol,
        rootPath: payload.rootPath?.trim() || (payload.protocol === 'sftp' ? '.' : '/'),
        entries: [],
      };
    }

    set({ testingConnection: true });
    try {
      const result = await window.electronAPI.remoteTest(payload, existingConnectionId);
      set({ testingConnection: false });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ testingConnection: false });
      return {
        success: false,
        message: 'Connection test failed',
        error: message,
        protocol: payload.protocol,
        rootPath: payload.rootPath?.trim() || (payload.protocol === 'sftp' ? '.' : '/'),
        entries: [],
      };
    }
  },

  connectConnection: async (id) => {
    if (!window.electronAPI?.remoteConnect) {
      return {
        success: false,
        message: getUnavailableMessage(),
        error: 'IPC_UNAVAILABLE',
        connectionId: id,
        rootPath: '/',
        entries: [],
      };
    }

    set({ connectingConnectionId: id });
    try {
      const result = await window.electronAPI.remoteConnect(id);
      if (result.success) {
        set({
          previewConnectionId: id,
          previewRootPath: result.rootPath,
          previewEntries: result.entries,
        });
        await get().fetchConnections();
      }
      set({ connectingConnectionId: null });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ connectingConnectionId: null });
      return {
        success: false,
        message: 'Failed to connect',
        error: message,
        connectionId: id,
        rootPath: '/',
        entries: [],
      };
    }
  },

  disconnectConnection: async (id) => {
    if (!window.electronAPI?.remoteDisconnect) {
      return {
        success: false,
        message: getUnavailableMessage(),
        error: 'IPC_UNAVAILABLE',
      };
    }

    set({ disconnectingConnectionId: id });
    try {
      const result = await window.electronAPI.remoteDisconnect(id);
      if (result.success && get().previewConnectionId === id) {
        set({
          previewConnectionId: null,
          previewRootPath: null,
          previewEntries: [],
        });
      }
      await get().fetchConnections();
      set({ disconnectingConnectionId: null });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ disconnectingConnectionId: null });
      return {
        success: false,
        message: 'Failed to disconnect',
        error: message,
      };
    }
  },

  loadPreview: async (id) => {
    if (!window.electronAPI?.remoteListRoot) {
      return {
        success: false,
        message: getUnavailableMessage(),
        error: 'IPC_UNAVAILABLE',
        connectionId: id,
        rootPath: '/',
        entries: [],
      };
    }

    set({ loadingPreviewConnectionId: id, pageError: null });
    try {
      const result = await window.electronAPI.remoteListRoot(id);
      if (result.success) {
        set({
          previewConnectionId: id,
          previewRootPath: result.rootPath,
          previewEntries: result.entries,
          loadingPreviewConnectionId: null,
        });
      } else {
        set({ loadingPreviewConnectionId: null, pageError: result.error ?? result.message });
      }
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ loadingPreviewConnectionId: null, pageError: message });
      return {
        success: false,
        message: 'Failed to load remote root',
        error: message,
        connectionId: id,
        rootPath: '/',
        entries: [],
      };
    }
  },

  clearPreview: () => {
    set({
      previewConnectionId: null,
      previewRootPath: null,
      previewEntries: [],
    });
  },
}));
