/**
 * Electron Main Process
 *
 * Entry point for the DevStack Local application.
 * Creates the main BrowserWindow, sets up IPC handlers for service management,
 * and configures the application lifecycle (ready, close, quit).
 *
 * Phase 2.5: Real process management with tree-kill, electron-store persistence,
 * and proper service error broadcasting.
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { ProcessManager } from './services/process.manager';
import { PhpService } from './services/php.service';
import { DomainService } from './services/domain.service';
import { DatabaseService } from './services/database.service';
import { resolveAppIconPath } from './utils/runtime.paths';
import type { DomainInput } from '../src/types/domain.types';

/** Singleton reference to the main application window */
let mainWindow: BrowserWindow | null = null;

/** Central process manager for all services */
const processManager = new ProcessManager();

/** PHP version manager */
const phpService = new PhpService();
phpService.setProcessManager(processManager);

/** Domain and virtual host manager */
const domainService = new DomainService(processManager, phpService);

/** Database manager */
const databaseService = new DatabaseService(processManager);

/** Track whether we're already quitting to prevent double-stop */
let isQuitting = false;

/**
 * Create the main application window.
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: '#0a0e1a',
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#131829',
      symbolColor: '#9ca3af',
      height: 40,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Register the window with the process manager for IPC broadcasts
  processManager.setMainWindow(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupPackagedSmokeExitTimer(): void {
  const raw = process.env.DEVSTACK_SMOKE_EXIT_MS;
  if (!raw) return;

  const timeoutMs = Number(raw);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.warn(`[smoke] Ignoring invalid DEVSTACK_SMOKE_EXIT_MS value: ${raw}`);
    return;
  }

  setTimeout(async () => {
    if (isQuitting) return;
    isQuitting = true;
    try {
      await processManager.stopAllServices();
    } catch (err) {
      console.error('[smoke] Failed to stop services before exit:', err);
    }
    app.quit();
  }, timeoutMs);
}

/**
 * Register all IPC handlers.
 */
function registerIpcHandlers(): void {
  // ─── Service Management ─────────────────────────────────────────

  // Start a service
  ipcMain.handle('service:start', async (_event, service: string, config?: Record<string, unknown>) => {
    try {
      return await processManager.startService(service as 'apache' | 'mysql', config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      processManager.broadcastError(service, msg);
      return { success: false, message: `Failed to start ${service}`, error: msg };
    }
  });

  // Stop a service
  ipcMain.handle('service:stop', async (_event, service: string) => {
    try {
      return await processManager.stopService(service as 'apache' | 'mysql');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      processManager.broadcastError(service, msg);
      return { success: false, message: `Failed to stop ${service}`, error: msg };
    }
  });

  // Restart a service
  ipcMain.handle('service:restart', async (_event, service: string) => {
    try {
      return await processManager.restartService(service as 'apache' | 'mysql');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      processManager.broadcastError(service, msg);
      return { success: false, message: `Failed to restart ${service}`, error: msg };
    }
  });

  // Get service status
  ipcMain.handle('service:status', async (_event, service: string) => {
    try {
      return processManager.getServiceStatus(service as 'apache' | 'mysql');
    } catch (error) {
      return { status: 'stopped', version: '', port: 0 };
    }
  });

  // ─── PHP Version Management ────────────────────────────────────────

  ipcMain.handle('php:get-versions', async () => {
    return phpService.getAvailableVersions();
  });

  ipcMain.handle('php:set-active', async (_event, version: string) => {
    return phpService.setActiveVersion(version);
  });

  ipcMain.handle('php:get-active', async () => {
    return phpService.getActiveVersion();
  });

  ipcMain.handle('php:get-ini', async (_event, version: string) => {
    return phpService.getPhpIniContent(version);
  });

  ipcMain.handle('php:save-ini', async (_event, version: string, content: string) => {
    return phpService.savePhpIniContent(version, content);
  });

  ipcMain.handle('php:get-extensions', async (_event, version: string) => {
    return phpService.getExtensions(version);
  });

  ipcMain.handle('php:toggle-extension', async (_event, version: string, ext: string, enabled: boolean) => {
    return phpService.toggleExtension(version, ext, enabled);
  });

  ipcMain.handle('php:download', async (event, version: string) => {
    return phpService.downloadVersion(version, (progress) => {
      event.sender.send('php:download-progress', version, progress);
    });
  });

  ipcMain.handle('php:remove-version', async (_event, version: string) => {
    return phpService.removeVersion(version);
  });

  ipcMain.handle('domains:list', async () => {
    return domainService.listDomains();
  });

  ipcMain.handle('domains:create', async (_event, payload: DomainInput) => {
    return domainService.createDomain(payload);
  });

  ipcMain.handle('domains:update', async (_event, id: string, payload: DomainInput) => {
    return domainService.updateDomain(id, payload);
  });

  ipcMain.handle('domains:delete', async (_event, id: string) => {
    return domainService.deleteDomain(id);
  });

  ipcMain.handle('domains:open', async (_event, hostname: string) => {
    try {
      const normalized = hostname.trim().toLowerCase();
      if (!/^[a-z0-9.-]+$/.test(normalized) || normalized.includes('://')) {
        return { success: false, message: 'Invalid hostname', error: 'INVALID_HOSTNAME' };
      }

      await shell.openExternal(`http://${normalized}`);
      return { success: true, message: `Opened ${normalized} in browser` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Failed to open domain in browser', error: message };
    }
  });

  ipcMain.handle('domains:pick-project-path', async () => {
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Project Directory',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // ─── Application ───────────────────────────────────────────────────

  // Database Manager
  ipcMain.handle('db:list', async () => {
    return databaseService.listDatabases();
  });

  ipcMain.handle('db:create', async (_event, name: string) => {
    return databaseService.createDatabase(name);
  });

  ipcMain.handle('db:delete', async (_event, name: string) => {
    return databaseService.deleteDatabase(name);
  });

  ipcMain.handle('db:import', async (event, databaseName: string, filePath?: string) => {
    try {
      let sourcePath = filePath?.trim() || '';
      if (!sourcePath) {
        const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
        const dialogOptions = {
          title: 'Import SQL File',
          properties: ['openFile'] as const,
          filters: [{ name: 'SQL Files', extensions: ['sql'] }],
        };
        const selected = ownerWindow
          ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions);

        if (selected.canceled || selected.filePaths.length === 0) {
          return { success: false, message: 'Import cancelled', error: 'CANCELLED' };
        }

        sourcePath = selected.filePaths[0];
      }

      return databaseService.importSqlFile(databaseName, sourcePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Failed to import SQL file', error: message };
    }
  });

  ipcMain.handle('db:export', async (event, databaseName: string, filePath?: string) => {
    try {
      let targetPath = filePath?.trim() || '';
      if (!targetPath) {
        const safeDatabaseName = databaseName.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'database';
        const timestamp = new Date()
          .toISOString()
          .replace(/[-:]/g, '')
          .replace('T', '-')
          .slice(0, 15);

        const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
        const dialogOptions = {
          title: 'Export Database SQL',
          defaultPath: `${safeDatabaseName}-${timestamp}.sql`,
          filters: [{ name: 'SQL Files', extensions: ['sql'] }],
        };
        const selected = ownerWindow
          ? await dialog.showSaveDialog(ownerWindow, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions);

        if (selected.canceled || !selected.filePath) {
          return { success: false, message: 'Export cancelled', error: 'CANCELLED' };
        }

        targetPath = selected.filePath;
      }

      return databaseService.exportDatabase(databaseName, targetPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Failed to export database', error: message };
    }
  });

  // Application
  ipcMain.handle('app:exit', async () => {
    if (!mainWindow) return;

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Exit'],
      defaultId: 1,
      cancelId: 0,
      title: 'Exit DevStack',
      message: 'Are you sure you want to exit DevStack?',
      detail: 'All running services will be stopped.',
    });

    if (result.response === 1) {
      isQuitting = true;
      await processManager.stopAllServices();
      app.quit();
    }
  });
}

// ─── Application Lifecycle ───────────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  setupPackagedSmokeExitTimer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Graceful shutdown: stop all services before the app quits
app.on('before-quit', async (event) => {
  if (isQuitting) return; // Already handled
  isQuitting = true;
  event.preventDefault();

  try {
    await processManager.stopAllServices();
  } catch (err) {
    console.error('Error stopping services on quit:', err);
  }

  app.exit(0);
});
