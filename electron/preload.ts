/**
 * Electron Preload Script
 *
 * Creates a secure IPC bridge between the Electron main process
 * and the React renderer using contextBridge.
 *
 * Security: Only specific, whitelisted channels are exposed.
 * The renderer never gets direct access to Node.js or Electron APIs.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Expose a secure API to the renderer process via window.electronAPI.
 * All IPC communication is explicitly whitelisted here.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Start a service (apache or mysql) with optional configuration.
   * @param service - The service identifier
   * @param config - Optional configuration object (version, port, etc.)
   */
  startService: (service: string, config?: Record<string, unknown>) => {
    return ipcRenderer.invoke('service:start', service, config);
  },

  /**
   * Stop a running service.
   * @param service - The service identifier
   */
  stopService: (service: string) => {
    return ipcRenderer.invoke('service:stop', service);
  },

  /**
   * Get the current status of a service.
   * @param service - The service identifier
   */
  getServiceStatus: (service: string) => {
    return ipcRenderer.invoke('service:status', service);
  },

  /**
   * Subscribe to real-time log entries from the main process.
   * @param callback - Function called with each new log entry
   */
  onLogEntry: (callback: (log: unknown) => void) => {
    ipcRenderer.on('log:entry', (_event, log) => callback(log));
  },

  /** Remove all log entry listeners */
  removeLogListener: () => {
    ipcRenderer.removeAllListeners('log:entry');
  },

  /**
   * Subscribe to service status change events.
   * @param callback - Function called with service name and new status
   */
  onServiceStatusChange: (callback: (payload: unknown) => void) => {
    ipcRenderer.on('service:status-change', (_event, payload) => callback(payload));
  },

  /** Remove all service status change listeners */
  removeServiceStatusListener: () => {
    ipcRenderer.removeAllListeners('service:status-change');
  },

  /** Request application exit (shows confirmation dialog) */
  exitApp: () => {
    return ipcRenderer.invoke('app:exit');
  },

  // ─── PHP Version Management ──────────────────────────────────────

  /** Get all available PHP versions */
  phpGetVersions: () => ipcRenderer.invoke('php:get-versions'),

  /** Set the active PHP version */
  phpSetActive: (version: string) => ipcRenderer.invoke('php:set-active', version),

  /** Get the active PHP version string */
  phpGetActive: () => ipcRenderer.invoke('php:get-active'),

  /** Get php.ini content for a version */
  phpGetIni: (version: string) => ipcRenderer.invoke('php:get-ini', version),

  /** Save php.ini content for a version */
  phpSaveIni: (version: string, content: string) =>
    ipcRenderer.invoke('php:save-ini', version, content),

  /** Get extensions list for a version */
  phpGetExtensions: (version: string) => ipcRenderer.invoke('php:get-extensions', version),

  /** Toggle an extension on/off */
  phpToggleExtension: (version: string, ext: string, enabled: boolean) =>
    ipcRenderer.invoke('php:toggle-extension', version, ext, enabled),

  /** Download and install a PHP version */
  phpDownload: (version: string) => ipcRenderer.invoke('php:download', version),

  /** Remove an installed PHP version */
  phpRemoveVersion: (version: string) => ipcRenderer.invoke('php:remove-version', version),

  /** Listen for download progress updates */
  onPhpDownloadProgress: (callback: (version: string, progress: number) => void) => {
    ipcRenderer.on('php:download-progress', (_event, version, progress) =>
      callback(version, progress)
    );
  },

  /** Remove download progress listener */
  removePhpDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('php:download-progress');
  },
});
