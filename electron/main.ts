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

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { ProcessManager } from './services/process.manager';
import { PhpService } from './services/php.service';
import { ConfigStore } from './utils/config.store';

/** Singleton reference to the main application window */
let mainWindow: BrowserWindow | null = null;

/** Central process manager for all services */
const processManager = new ProcessManager();

/** PHP version manager */
const phpService = new PhpService();

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
    icon: path.join(__dirname, '../public/icon.ico'),
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

  // Wire PHP service to process manager for PHP-CGI spawning and logging
  phpService.setProcessManager(processManager);
  phpService.setLogEmitter((level, message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const logEntry = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        timestamp: new Date(),
        level,
        message,
      };
      mainWindow.webContents.send('log:entry', logEntry);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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

  // ─── Application ───────────────────────────────────────────────────

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
