/**
 * PHP Service Manager — Real Implementation
 *
 * Manages PHP versions, php.ini configuration, extensions, and PHP-CGI processes.
 *
 * Features:
 * - Scans resources/binaries/php/{version}/ for installed versions
 * - Reads/writes real php.ini files from disk with backup
 * - Spawns php-cgi.exe -b 127.0.0.1:{port} per active version
 * - Dynamic port assignment based on version
 * - On version switch: kills old PHP-CGI, starts new one
 * - Download still simulated (directory creation; real download in Phase 4)
 * - Persists state via ConfigStore
 */

import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { PhpVersion, PhpExtension, PhpOperationResult } from '../../src/types/php.types';
import { isPortAvailable } from '../utils/port.util';
import { ConfigStore } from '../utils/config.store';

/** Forward reference to ProcessManager for PHP-CGI spawning */
import type { ProcessManager } from './process.manager';

type LogEmitter = (level: string, message: string) => void;

/** Default php.ini content for new installations */
const DEFAULT_PHP_INI = `[PHP]
engine = On
short_open_tag = Off
precision = 14
output_buffering = 4096
zlib.output_compression = Off

max_execution_time = 30
max_input_time = 60
memory_limit = 128M

error_reporting = E_ALL & ~E_DEPRECATED & ~E_STRICT
display_errors = On
display_startup_errors = On
log_errors = On
error_log = "C:/devstack/logs/php_error.log"

post_max_size = 8M
upload_max_filesize = 2M
max_file_uploads = 20

[Date]
date.timezone = Asia/Ho_Chi_Minh

[MySQLi]
mysqli.max_persistent = -1
mysqli.allow_persistent = On
mysqli.max_links = -1
mysqli.default_port = 3306
mysqli.default_socket =
mysqli.default_host =
mysqli.default_user =
mysqli.default_pw =

[Extensions]
; Uncomment to enable extensions
extension=mysqli
extension=pdo_mysql
extension=mbstring
extension=openssl
;extension=curl
;extension=gd
;extension=fileinfo
;extension=zip
;extension=intl
;extension=soap
`;

/** Version catalog — available for download */
const VERSION_CATALOG: Array<{ version: string; size: string }> = [
  { version: '8.5.1', size: '32 MB' },
  { version: '8.5.0', size: '32 MB' },
  { version: '8.3.29', size: '30 MB' },
  { version: '7.4.30', size: '28 MB' },
  { version: '5.6.9', size: '24 MB' },
];

/** Common PHP extensions with metadata */
const COMMON_EXTENSIONS: PhpExtension[] = [
  { name: 'mysqli', description: 'MySQL improved extension', required: true, enabled: true },
  { name: 'pdo_mysql', description: 'PDO MySQL driver', required: true, enabled: true },
  { name: 'mbstring', description: 'Multibyte string support', required: true, enabled: true },
  { name: 'openssl', description: 'OpenSSL support', required: true, enabled: true },
  { name: 'curl', description: 'cURL support', required: false, enabled: false },
  { name: 'gd', description: 'Image processing', required: false, enabled: false },
  { name: 'fileinfo', description: 'File information', required: false, enabled: false },
  { name: 'zip', description: 'ZIP archive support', required: false, enabled: false },
  { name: 'intl', description: 'Internationalization', required: false, enabled: false },
  { name: 'soap', description: 'SOAP protocol', required: false, enabled: false },
];

export class PhpService {
  private activeVersion: string;
  private logEmitter: LogEmitter | null = null;
  private processManager: ProcessManager | null = null;

  /** In-memory cache for php.ini content (only used when real files don't exist) */
  private phpIniCache: Map<string, string> = new Map();

  constructor() {
    // Restore active version from persistent store
    this.activeVersion = ConfigStore.getActivePhpVersion();
  }

  /** Set ProcessManager reference for PHP-CGI spawning */
  setProcessManager(pm: ProcessManager): void {
    this.processManager = pm;
  }

  /** Register a log emitter callback */
  setLogEmitter(emitter: LogEmitter): void {
    this.logEmitter = emitter;
  }

  // ─── Version Management ───────────────────────────────────────────

  /**
   * Get the list of all available PHP versions.
   * Scans both the catalog and the file system for installed versions.
   */
  async getAvailableVersions(): Promise<PhpVersion[]> {
    const installedOnDisk = this.scanInstalledVersions();

    // Merge saved installed versions with disk scan
    const savedInstalled = ConfigStore.getInstalledPhpVersions();
    const allInstalled = new Set([...installedOnDisk, ...savedInstalled]);

    return VERSION_CATALOG.map((v) => ({
      version: v.version,
      path: allInstalled.has(v.version)
        ? this.getVersionDir(v.version)
        : '',
      installed: allInstalled.has(v.version),
      active: v.version === this.activeVersion,
      size: v.size,
      downloadUrl: `https://windows.php.net/downloads/releases/php-${v.version}-Win32-vs16-x64.zip`,
    }));
  }

  /**
   * Set the active PHP version.
   * Stops the old PHP-CGI process and starts a new one.
   */
  async setActiveVersion(version: string): Promise<PhpOperationResult> {
    const installed = this.isVersionInstalled(version);
    if (!installed) {
      return { success: false, message: `PHP ${version} is not installed`, error: 'NOT_INSTALLED' };
    }

    const previousVersion = this.activeVersion;
    this.emitLog('system', `Switching PHP version from ${previousVersion} to ${version}...`);

    // Stop old PHP-CGI process if running
    if (this.processManager) {
      const oldProcessName = `php-cgi-${previousVersion}`;
      if (this.processManager.isRunning(oldProcessName)) {
        this.emitLog('system', `Stopping PHP-CGI for ${previousVersion}...`);
        await this.processManager.stopProcess(oldProcessName);
      }
    }

    this.activeVersion = version;
    ConfigStore.setActivePhpVersion(version);

    // Start new PHP-CGI process
    await this.startPhpCgi(version);

    this.emitLog('success', `PHP ${version} is now active`);
    return { success: true, message: `PHP ${version} activated successfully` };
  }

  /** Get the currently active PHP version string */
  getActiveVersion(): string {
    return this.activeVersion;
  }

  // ─── PHP-CGI Process Management ───────────────────────────────────

  /**
   * Start a PHP-CGI FastCGI process for the given version.
   * Binds to 127.0.0.1:{port} where port is derived from version.
   */
  async startPhpCgi(version: string): Promise<void> {
    if (!this.processManager) {
      this.emitLog('warning', 'ProcessManager not set — cannot start PHP-CGI');
      return;
    }

    const phpCgiPath = this.getPhpCgiPath(version);
    if (!phpCgiPath || !fs.existsSync(phpCgiPath)) {
      this.emitLog('warning', `php-cgi.exe not found for PHP ${version}`);
      return;
    }

    const port = this.getPhpCgiPort(version);
    const processName = `php-cgi-${version}`;

    // Check port availability
    const available = await isPortAvailable(port);
    if (!available) {
      this.emitLog('error', `Port ${port} is already in use for PHP-CGI ${version}`);
      return;
    }

    this.emitLog('system', `Starting PHP-CGI ${version} on 127.0.0.1:${port}...`);

    this.processManager.startProcess(
      processName,
      phpCgiPath,
      ['-b', `127.0.0.1:${port}`],
      {
        cwd: path.dirname(phpCgiPath),
        windowsHide: true,
      }
    );

    // Verify it started
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (this.processManager.isRunning(processName)) {
      this.emitLog('success', `PHP-CGI ${version} listening on 127.0.0.1:${port}`);
    } else {
      this.emitLog('warning', `PHP-CGI ${version} may not have started correctly`);
    }
  }

  /**
   * Stop the PHP-CGI process for a given version.
   */
  async stopPhpCgi(version: string): Promise<void> {
    if (!this.processManager) return;

    const processName = `php-cgi-${version}`;
    if (this.processManager.isRunning(processName)) {
      await this.processManager.stopProcess(processName);
      this.emitLog('system', `PHP-CGI ${version} stopped`);
    }
  }

  /**
   * Get the PHP-CGI port for a given version.
   * Maps major.minor to port: 7.4 → 9074, 8.3 → 9083, 8.5 → 9085
   */
  private getPhpCgiPort(version: string): number {
    const parts = version.split('.');
    if (parts.length >= 2) {
      const major = parseInt(parts[0], 10);
      const minor = parseInt(parts[1], 10);
      return 9000 + (major * 10) + minor;
    }
    return 9000;
  }

  /** Get path to php-cgi.exe for a version */
  private getPhpCgiPath(version: string): string | null {
    const versionDir = this.getVersionDir(version);
    if (!versionDir) return null;
    const cgiPath = path.join(versionDir, 'php-cgi.exe');
    return fs.existsSync(cgiPath) ? cgiPath : null;
  }

  // ─── php.ini Management ───────────────────────────────────────────

  /**
   * Get php.ini content for a specific version.
   * Reads from disk if available, falls back to cache or default.
   */
  async getPhpIniContent(version: string): Promise<string> {
    // Try reading from disk first
    const iniPath = this.getPhpIniPath(version);
    if (iniPath && fs.existsSync(iniPath)) {
      try {
        return fs.readFileSync(iniPath, 'utf-8');
      } catch (err) {
        this.emitLog('warning', `Could not read php.ini from ${iniPath}: ${err}`);
      }
    }

    // Fall back to cache or default
    return this.phpIniCache.get(version) ?? DEFAULT_PHP_INI;
  }

  /**
   * Save php.ini content for a specific version.
   * Creates a backup before overwriting.
   */
  async savePhpIniContent(version: string, content: string): Promise<PhpOperationResult> {
    try {
      this.emitLog('system', `Saving php.ini for PHP ${version}...`);

      const iniPath = this.getPhpIniPath(version);

      if (iniPath) {
        // Create backup
        if (fs.existsSync(iniPath)) {
          const backupPath = `${iniPath}.bak`;
          fs.copyFileSync(iniPath, backupPath);
          this.emitLog('system', `Backup created: ${backupPath}`);
        }

        // Write new content
        fs.writeFileSync(iniPath, content, 'utf-8');
        this.emitLog('success', `php.ini saved to ${iniPath}`);
      } else {
        // Save to cache if no disk path available
        this.phpIniCache.set(version, content);
        this.emitLog('success', `php.ini saved to memory for PHP ${version}`);
      }

      return { success: true, message: 'php.ini saved successfully' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.emitLog('error', `Failed to save php.ini: ${msg}`);
      return { success: false, message: 'Failed to save php.ini', error: msg };
    }
  }

  /** Get the php.ini file path for a version */
  private getPhpIniPath(version: string): string | null {
    const versionDir = this.getVersionDir(version);
    if (!versionDir) return null;

    // Check for php.ini, then php.ini-development
    const candidates = [
      path.join(versionDir, 'php.ini'),
      path.join(versionDir, 'php.ini-development'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }

    // Return the standard path even if it doesn't exist yet (for saving)
    return path.join(versionDir, 'php.ini');
  }

  // ─── Extension Management ─────────────────────────────────────────

  /**
   * Get the list of extensions for a specific version.
   * Parses the php.ini content to determine enabled status.
   */
  async getExtensions(version: string): Promise<PhpExtension[]> {
    const iniContent = await this.getPhpIniContent(version);

    return COMMON_EXTENSIONS.map((ext) => {
      const enabledPattern = new RegExp(`^extension=${ext.name}\\s*$`, 'm');
      const disabledPattern = new RegExp(`^;extension=${ext.name}\\s*$`, 'm');

      let enabled = ext.enabled;
      if (enabledPattern.test(iniContent)) {
        enabled = true;
      } else if (disabledPattern.test(iniContent)) {
        enabled = false;
      }

      return { ...ext, enabled };
    });
  }

  /**
   * Toggle a PHP extension on or off by modifying php.ini.
   */
  async toggleExtension(
    version: string,
    extensionName: string,
    enabled: boolean
  ): Promise<PhpOperationResult> {
    const iniContent = await this.getPhpIniContent(version);

    let updatedContent: string;
    if (enabled) {
      updatedContent = iniContent.replace(
        new RegExp(`^;extension=${extensionName}`, 'm'),
        `extension=${extensionName}`
      );
    } else {
      updatedContent = iniContent.replace(
        new RegExp(`^extension=${extensionName}`, 'm'),
        `;extension=${extensionName}`
      );
    }

    // Save the modified content
    await this.savePhpIniContent(version, updatedContent);

    const action = enabled ? 'enabled' : 'disabled';
    this.emitLog('success', `Extension ${extensionName} ${action} for PHP ${version}`);

    return {
      success: true,
      message: `Extension ${extensionName} ${action}`,
    };
  }

  // ─── Download / Install ───────────────────────────────────────────

  /**
   * Download and install a PHP version.
   * Currently simulated — creates directory structure.
   * Real binary download will be implemented in Phase 4.
   */
  async downloadVersion(
    version: string,
    onProgress: (percent: number) => void
  ): Promise<PhpOperationResult> {
    if (this.isVersionInstalled(version)) {
      return { success: false, message: `PHP ${version} is already installed`, error: 'ALREADY_INSTALLED' };
    }

    this.emitLog('system', `Downloading PHP ${version}...`);

    // Simulate download progress
    for (let i = 0; i <= 100; i += 5) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      onProgress(i);
    }

    // Create version directory structure
    const versionDir = this.getVersionDir(version) || this.createVersionDir(version);
    if (versionDir) {
      // Write default php.ini
      const iniPath = path.join(versionDir, 'php.ini');
      if (!fs.existsSync(iniPath)) {
        try {
          fs.writeFileSync(iniPath, DEFAULT_PHP_INI, 'utf-8');
        } catch {
          // Store in cache if disk write fails
          this.phpIniCache.set(version, DEFAULT_PHP_INI);
        }
      }
    } else {
      // Fallback: store in memory
      this.phpIniCache.set(version, DEFAULT_PHP_INI);
    }

    // Update persistent store
    const installed = ConfigStore.getInstalledPhpVersions();
    if (!installed.includes(version)) {
      ConfigStore.setInstalledPhpVersions([...installed, version]);
    }

    this.emitLog('success', `PHP ${version} installed successfully`);
    return { success: true, message: `PHP ${version} installed successfully` };
  }

  /**
   * Remove an installed PHP version.
   */
  async removeVersion(version: string): Promise<PhpOperationResult> {
    if (!this.isVersionInstalled(version)) {
      return { success: false, message: `PHP ${version} is not installed`, error: 'NOT_INSTALLED' };
    }
    if (version === this.activeVersion) {
      return { success: false, message: 'Cannot remove the active PHP version', error: 'IS_ACTIVE' };
    }

    // Stop PHP-CGI if running
    await this.stopPhpCgi(version);

    // Remove from persistent store
    const installed = ConfigStore.getInstalledPhpVersions();
    ConfigStore.setInstalledPhpVersions(installed.filter((v) => v !== version));

    // Remove cached content
    this.phpIniCache.delete(version);

    this.emitLog('success', `PHP ${version} removed`);
    return { success: true, message: `PHP ${version} removed successfully` };
  }

  // ─── Internal Helpers ─────────────────────────────────────────────

  /** Scan the file system for installed PHP versions */
  private scanInstalledVersions(): string[] {
    const phpBaseDirs = this.getPhpBaseDirs();
    const versions: string[] = [];

    for (const baseDir of phpBaseDirs) {
      if (!fs.existsSync(baseDir)) continue;

      try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            // Check if it contains php.exe or php-cgi.exe
            const phpExe = path.join(baseDir, entry.name, 'php.exe');
            const phpCgi = path.join(baseDir, entry.name, 'php-cgi.exe');
            if (fs.existsSync(phpExe) || fs.existsSync(phpCgi)) {
              versions.push(entry.name);
            }
          }
        }
      } catch {
        // Directory not readable
      }
    }

    return versions;
  }

  /** Check if a version is installed (on disk or in persistent store) */
  private isVersionInstalled(version: string): boolean {
    const onDisk = this.scanInstalledVersions();
    const saved = ConfigStore.getInstalledPhpVersions();
    return onDisk.includes(version) || saved.includes(version);
  }

  /** Get the directory path for a PHP version */
  private getVersionDir(version: string): string {
    const baseDirs = this.getPhpBaseDirs();
    for (const baseDir of baseDirs) {
      const versionDir = path.join(baseDir, version);
      if (fs.existsSync(versionDir)) return versionDir;
    }
    // Return default path even if doesn't exist
    return path.join(this.getPhpBaseDirs()[0], version);
  }

  /** Create a version directory for new installation */
  private createVersionDir(version: string): string | null {
    try {
      const baseDir = this.getPhpBaseDirs()[0];
      const versionDir = path.join(baseDir, version);
      fs.mkdirSync(versionDir, { recursive: true });
      return versionDir;
    } catch {
      return null;
    }
  }

  /** Get PHP base directories to scan */
  private getPhpBaseDirs(): string[] {
    const dirs: string[] = [];

    // Custom path from config
    const savedPath = ConfigStore.getBinaryPath('php');
    if (savedPath) dirs.push(savedPath);

    // Project paths
    dirs.push(
      path.join(app?.getAppPath?.() ?? process.cwd(), 'resources', 'binaries', 'php'),
      path.join(process.cwd(), 'resources', 'binaries', 'php')
    );

    return dirs;
  }

  /** Emit a log message */
  private emitLog(level: string, message: string): void {
    if (this.processManager) {
      this.processManager.broadcastLog(level, message);
    }
    if (this.logEmitter) {
      this.logEmitter(level, message);
    }
  }
}
