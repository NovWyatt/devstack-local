/**
 * Global Application State Store (Zustand)
 *
 * Manages the state of all services, logs, and application-level actions.
 * This store serves as the single source of truth for the React renderer
 * and handles communication with the Electron main process via IPC.
 */

import { create } from 'zustand';
import type { ServiceState, LogEntry, ServiceName, ServiceStatusPayload } from '../types';
import { generateId } from '../lib/utils';

/** Shape of the global application state */
interface AppStore {
  // ─── Service State ───────────────────────────────────────────────
  apache: ServiceState;
  mysql: ServiceState;

  // ─── Log State ───────────────────────────────────────────────────
  logs: LogEntry[];

  // ─── Service Actions ─────────────────────────────────────────────
  /** Start a service and update its status through transitions */
  startService: (service: ServiceName) => Promise<void>;
  /** Stop a service and update its status through transitions */
  stopService: (service: ServiceName) => Promise<void>;
  /** Update a service's state directly (used by IPC listeners) */
  updateServiceStatus: (service: ServiceName, status: Partial<ServiceState>) => void;

  // ─── Log Actions ─────────────────────────────────────────────────
  /** Add a new log entry to the list */
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  /** Clear all log entries */
  clearLogs: () => void;

  // ─── App Actions ─────────────────────────────────────────────────
  /** Initialize IPC listeners for log and status updates */
  initIpcListeners: () => void;
  /** Clean up IPC listeners */
  cleanupIpcListeners: () => void;
}

/** Default initial state for Apache */
const initialApacheState: ServiceState = {
  status: 'stopped',
  version: '8.5.1',
  port: 80,
};

/** Default initial state for MySQL */
const initialMySQLState: ServiceState = {
  status: 'stopped',
  version: '8.0',
  port: 3306,
};

/**
 * Create the Zustand store with all service and log management logic.
 * Uses the Electron IPC bridge when available, falls back to mock behavior
 * when running in a regular browser (for development without Electron).
 */
export const useAppStore = create<AppStore>((set, get) => ({
  // ─── Initial State ─────────────────────────────────────────────────
  apache: { ...initialApacheState },
  mysql: { ...initialMySQLState },
  logs: [],

  // ─── Service Actions ───────────────────────────────────────────────

  startService: async (service: ServiceName) => {
    const currentState = get()[service];
    if (currentState.status === 'running' || currentState.status === 'starting') return;

    // Transition to 'starting' state immediately
    set((state) => ({
      [service]: { ...state[service], status: 'starting' as const },
    }));

    // Add a log entry for the start attempt
    get().addLog({ level: 'system', message: `Requesting ${service} start...` });

    try {
      if (window.electronAPI) {
        // Use real IPC in Electron environment
        await window.electronAPI.startService(service);
      } else {
        // Mock behavior for browser-only development
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const mockPid = Math.floor(Math.random() * 90000) + 10000;
        set((state) => ({
          [service]: { ...state[service], status: 'running' as const, pid: mockPid },
        }));
        get().addLog({ level: 'success', message: `${service} started successfully (PID: ${mockPid})` });
      }
    } catch (error) {
      // Revert to stopped on failure
      set((state) => ({
        [service]: { ...state[service], status: 'stopped' as const },
      }));
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      get().addLog({ level: 'error', message: `Failed to start ${service}: ${errorMessage}` });
    }
  },

  stopService: async (service: ServiceName) => {
    const currentState = get()[service];
    if (currentState.status === 'stopped' || currentState.status === 'stopping') return;

    // Transition to 'stopping' state immediately
    set((state) => ({
      [service]: { ...state[service], status: 'stopping' as const },
    }));

    get().addLog({ level: 'system', message: `Requesting ${service} stop...` });

    try {
      if (window.electronAPI) {
        await window.electronAPI.stopService(service);
      } else {
        // Mock behavior for browser-only development
        await new Promise((resolve) => setTimeout(resolve, 1000));
        set((state) => ({
          [service]: { ...state[service], status: 'stopped' as const, pid: undefined },
        }));
        get().addLog({ level: 'success', message: `${service} stopped successfully` });
      }
    } catch (error) {
      // Revert to running on failure
      set((state) => ({
        [service]: { ...state[service], status: 'running' as const },
      }));
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      get().addLog({ level: 'error', message: `Failed to stop ${service}: ${errorMessage}` });
    }
  },

  updateServiceStatus: (service: ServiceName, status: Partial<ServiceState>) => {
    set((state) => ({
      [service]: { ...state[service], ...status },
    }));
  },

  // ─── Log Actions ───────────────────────────────────────────────────

  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => {
    const entry: LogEntry = {
      id: generateId(),
      timestamp: new Date(),
      ...log,
    };

    set((state) => ({
      logs: [...state.logs, entry],
    }));
  },

  clearLogs: () => {
    set({ logs: [] });
  },

  // ─── IPC Listener Management ──────────────────────────────────────

  initIpcListeners: () => {
    if (!window.electronAPI) return;

    // Listen for log entries from the main process
    window.electronAPI.onLogEntry((log: unknown) => {
      const logEntry = log as LogEntry;
      // Avoid duplicating the log by creating a new entry with a fresh timestamp
      set((state) => ({
        logs: [
          ...state.logs,
          {
            id: logEntry.id || generateId(),
            timestamp: new Date(logEntry.timestamp),
            level: logEntry.level,
            message: logEntry.message,
          },
        ],
      }));
    });

    // Listen for service status changes from the main process
    window.electronAPI.onServiceStatusChange((payload: unknown) => {
      const { service, status } = payload as ServiceStatusPayload;
      set((state) => ({
        [service]: { ...state[service], ...status },
      }));
    });
  },

  cleanupIpcListeners: () => {
    if (!window.electronAPI) return;
    window.electronAPI.removeLogListener();
    window.electronAPI.removeServiceStatusListener();
  },
}));
