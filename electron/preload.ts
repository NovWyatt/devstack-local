/**
 * Electron Preload Script
 *
 * Creates a secure IPC bridge between the Electron main process
 * and the React renderer using contextBridge.
 *
 * Security: Only specific, whitelisted channels are exposed.
 * The renderer never gets direct access to Node.js or Electron APIs.
 *
 * Phase 2.5: Added restart, error handling, and service error listeners.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Service Management ────────────────────────────────────────

  /** Start a service (apache or mysql) with optional configuration */
  startService: (service: string, config?: Record<string, unknown>) => {
    return ipcRenderer.invoke('service:start', service, config);
  },

  /** Stop a running service */
  stopService: (service: string) => {
    return ipcRenderer.invoke('service:stop', service);
  },

  /** Restart a service (stop + start) */
  restartService: (service: string) => {
    return ipcRenderer.invoke('service:restart', service);
  },

  /** Get the current status of a service */
  getServiceStatus: (service: string) => {
    return ipcRenderer.invoke('service:status', service);
  },

  // ─── Log & Event Listeners ────────────────────────────────────

  /** Subscribe to real-time log entries from the main process */
  onLogEntry: (callback: (log: unknown) => void) => {
    ipcRenderer.on('log:entry', (_event, log) => callback(log));
  },

  /** Remove all log entry listeners */
  removeLogListener: () => {
    ipcRenderer.removeAllListeners('log:entry');
  },

  /** Subscribe to service status change events */
  onServiceStatusChange: (callback: (payload: unknown) => void) => {
    ipcRenderer.on('service:status-change', (_event, payload) => callback(payload));
  },

  /** Remove all service status change listeners */
  removeServiceStatusListener: () => {
    ipcRenderer.removeAllListeners('service:status-change');
  },

  /** Subscribe to service error events */
  onServiceError: (callback: (payload: { service: string; error: string }) => void) => {
    ipcRenderer.on('service:error', (_event, payload) => callback(payload));
  },

  /** Remove service error listeners */
  removeServiceErrorListener: () => {
    ipcRenderer.removeAllListeners('service:error');
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

  /** List configured local domains */
  domainsList: () => ipcRenderer.invoke('domains:list'),

  /** Create a domain + vhost definition */
  domainsCreate: (payload: { hostname: string; projectPath: string; phpVersion?: string | null }) =>
    ipcRenderer.invoke('domains:create', payload),

  /** Update an existing domain + vhost definition */
  domainsUpdate: (
    id: string,
    payload: { hostname: string; projectPath: string; phpVersion?: string | null }
  ) => ipcRenderer.invoke('domains:update', id, payload),

  /** Delete a domain + vhost definition */
  domainsDelete: (id: string) => ipcRenderer.invoke('domains:delete', id),

  /** Open a domain in the default browser */
  domainsOpen: (hostname: string) => ipcRenderer.invoke('domains:open', hostname),

  /** Open native folder picker for project path */
  domainsPickProjectPath: () => ipcRenderer.invoke('domains:pick-project-path'),

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
