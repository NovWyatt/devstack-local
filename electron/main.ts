/**
 * Electron Main Process
 *
 * Entry point for the DevStack Local application.
 * Creates the main BrowserWindow, sets up IPC handlers for service management,
 * and configures the application lifecycle (ready, close, quit).
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { ProcessManager } from './services/process.manager';
import { PhpService } from './services/php.service';

/** Singleton reference to the main application window */
let mainWindow: BrowserWindow | null = null;

/** Central process manager for all services */
const processManager = new ProcessManager();

/** PHP version manager */
const phpService = new PhpService();

/**
 * Create the main application window.
 * Configures window size, appearance, and web preferences for security.
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
    // Frameless for modern look with custom title bar
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#131829',
      symbolColor: '#9ca3af',
      height: 40,
    },
    show: false, // Show after ready-to-show to prevent flash
  });

  // Show window once content is ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load the app — Vite dev server in development, built files in production
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // Open DevTools in development
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Register the window with the process manager for IPC broadcasts
  processManager.setMainWindow(mainWindow);

  // Wire PHP service log emitter to process manager's broadcast
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

  // Handle window close — prompt user, stop services first
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Register all IPC handlers for communication with the renderer process.
 * Each handler corresponds to a service management action.
 */
function registerIpcHandlers(): void {
  // Start a service (apache or mysql)
  ipcMain.handle('service:start', async (_event, service: string, config?: Record<string, unknown>) => {
    return processManager.startService(service as 'apache' | 'mysql', config);
  });

  // Stop a service
  ipcMain.handle('service:stop', async (_event, service: string) => {
    return processManager.stopService(service as 'apache' | 'mysql');
  });

  // Get service status
  ipcMain.handle('service:status', async (_event, service: string) => {
    return processManager.getServiceStatus(service as 'apache' | 'mysql');
  });

  // ─── PHP Version Management ────────────────────────────────────────

  // Get all available PHP versions
  ipcMain.handle('php:get-versions', async () => {
    return phpService.getAvailableVersions();
  });

  // Set the active PHP version
  ipcMain.handle('php:set-active', async (_event, version: string) => {
    return phpService.setActiveVersion(version);
  });

  // Get active PHP version
  ipcMain.handle('php:get-active', async () => {
    return phpService.getActiveVersion();
  });

  // Get php.ini content
  ipcMain.handle('php:get-ini', async (_event, version: string) => {
    return phpService.getPhpIniContent(version);
  });

  // Save php.ini content
  ipcMain.handle('php:save-ini', async (_event, version: string, content: string) => {
    return phpService.savePhpIniContent(version, content);
  });

  // Get extensions list
  ipcMain.handle('php:get-extensions', async (_event, version: string) => {
    return phpService.getExtensions(version);
  });

  // Toggle extension
  ipcMain.handle('php:toggle-extension', async (_event, version: string, ext: string, enabled: boolean) => {
    return phpService.toggleExtension(version, ext, enabled);
  });

  // Download/install a PHP version
  ipcMain.handle('php:download', async (event, version: string) => {
    return phpService.downloadVersion(version, (progress) => {
      event.sender.send('php:download-progress', version, progress);
    });
  });

  // Remove a PHP version
  ipcMain.handle('php:remove-version', async (_event, version: string) => {
    return phpService.removeVersion(version);
  });

  // ─── Application ───────────────────────────────────────────────────

  // Exit application with confirmation
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
      // Stop all running services before quitting
      await processManager.stopAllServices();
      app.quit();
    }
  });
}

// ─── Application Lifecycle ───────────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Graceful shutdown: stop all services before the app quits
app.on('before-quit', async (event) => {
  event.preventDefault();
  await processManager.stopAllServices();
  app.exit(0);
});
