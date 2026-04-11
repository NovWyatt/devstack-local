/**
 * PHP service manager.
 *
 * Handles:
 * - installed version discovery
 * - active version switching
 * - php.ini read/write
 * - extension toggles
 * - PHP-CGI process lifecycle
 */

import fs from 'fs';
import path from 'path';
import electron from 'electron';
import type { PhpExtension, PhpOperationResult, PhpVersion } from '../../src/types/php.types';
import { ConfigStore } from '../utils/config.store';
import { findAvailablePort, isPortAvailable, isPortListening } from '../utils/port.util';
import { retryOrThrow } from '../utils/retry.util';
import type { ProcessManager } from './process.manager';

type LogEmitter = (level: string, message: string) => void;

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

const VERSION_CATALOG: Array<{ version: string; size: string }> = [
  { version: '8.5.1', size: '32 MB' },
  { version: '8.5.0', size: '32 MB' },
  { version: '8.3.29', size: '30 MB' },
  { version: '7.4.30', size: '28 MB' },
  { version: '5.6.9', size: '24 MB' },
];

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

  private phpIniCache: Map<string, string> = new Map();
  private phpCgiPortMap: Map<string, number> = new Map();

  constructor() {
    this.activeVersion = ConfigStore.getActivePhpVersion();
  }

  setProcessManager(pm: ProcessManager): void {
    this.processManager = pm;
  }

  setLogEmitter(emitter: LogEmitter): void {
    this.logEmitter = emitter;
  }

  async getAvailableVersions(): Promise<PhpVersion[]> {
    const installedOnDisk = this.scanInstalledVersions();
    const installedFromStore = ConfigStore.getInstalledPhpVersions();
    const allInstalled = new Set([...installedOnDisk, ...installedFromStore]);

    return VERSION_CATALOG.map((item) => ({
      version: item.version,
      path: allInstalled.has(item.version) ? this.getVersionDir(item.version) : '',
      installed: allInstalled.has(item.version),
      active: item.version === this.activeVersion,
      size: item.size,
      downloadUrl: `https://windows.php.net/downloads/releases/php-${item.version}-Win32-vs16-x64.zip`,
    }));
  }

  async setActiveVersion(version: string): Promise<PhpOperationResult> {
    if (!this.isVersionInstalled(version)) {
      return { success: false, message: `PHP ${version} is not installed`, error: 'NOT_INSTALLED' };
    }

    if (version === this.activeVersion) {
      return { success: true, message: `PHP ${version} is already active` };
    }

    const previousVersion = this.activeVersion;
    const previousProcessName = `php-cgi-${previousVersion}`;
    const previousProcessWasRunning =
      !!this.processManager && this.processManager.isRunning(previousProcessName);

    this.emitLog('system', `Switching PHP version from ${previousVersion} to ${version}...`);

    if (previousProcessWasRunning && this.processManager) {
      await this.processManager.stopProcess(previousProcessName);
    }

    try {
      await this.startPhpCgi(version);
      this.activeVersion = version;
      ConfigStore.setActivePhpVersion(version);
      this.emitLog('success', `PHP ${version} is now active`);
      return { success: true, message: `PHP ${version} activated successfully` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (previousProcessWasRunning) {
        try {
          await this.startPhpCgi(previousVersion);
        } catch (restoreError) {
          this.emitLog(
            'warning',
            `Failed to restore PHP-CGI ${previousVersion}: ${
              restoreError instanceof Error ? restoreError.message : String(restoreError)
            }`
          );
        }
      }

      if (this.processManager) {
        this.processManager.broadcastError('php', message);
      }

      this.emitLog('error', `Failed to activate PHP ${version}: ${message}`);
      return { success: false, message: `Failed to activate PHP ${version}`, error: message };
    }
  }

  getActiveVersion(): string {
    return this.activeVersion;
  }

  async startPhpCgi(version: string): Promise<void> {
    if (!this.processManager) {
      throw new Error('ProcessManager not set - cannot start PHP-CGI');
    }

    const phpCgiPath = this.getPhpCgiPath(version);
    if (!phpCgiPath) {
      throw new Error(`php-cgi.exe not found for PHP ${version}`);
    }

    const processName = `php-cgi-${version}`;
    const port = await this.resolvePhpCgiPort(version);

    this.emitLog('system', `Starting PHP-CGI ${version} on 127.0.0.1:${port}...`);

    this.processManager.startProcess(
      processName,
      phpCgiPath,
      ['-b', `127.0.0.1:${port}`],
      {
        cwd: path.dirname(phpCgiPath),
        windowsHide: true,
      },
      true,
      { port, host: '127.0.0.1' }
    );

    try {
      await retryOrThrow(
        async () => {
          if (!this.processManager) return false;
          if (!this.processManager.isRunning(processName)) return false;
          return isPortListening(port, '127.0.0.1', 1000);
        },
        { attempts: 5, delayMs: 250 },
        `PHP-CGI ${version} failed runtime validation on 127.0.0.1:${port}`
      );

      this.phpCgiPortMap.set(version, port);
      this.processManager.resetRestartAttempts(processName);
      this.emitLog('success', `PHP-CGI ${version} listening on 127.0.0.1:${port}`);
    } catch (error) {
      if (this.processManager.isRunning(processName)) {
        await this.processManager.stopProcess(processName);
      }
      this.phpCgiPortMap.delete(version);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async stopPhpCgi(version: string): Promise<void> {
    if (!this.processManager) return;

    const processName = `php-cgi-${version}`;
    if (this.processManager.isRunning(processName)) {
      await this.processManager.stopProcess(processName);
      this.emitLog('system', `PHP-CGI ${version} stopped`);
    }

    this.phpCgiPortMap.delete(version);
  }

  async getPhpIniContent(version: string): Promise<string> {
    const iniPath = this.getPhpIniPath(version);
    if (iniPath && fs.existsSync(iniPath)) {
      try {
        return fs.readFileSync(iniPath, 'utf-8');
      } catch (error) {
        this.emitLog('warning', `Could not read php.ini from ${iniPath}: ${String(error)}`);
      }
    }

    return this.phpIniCache.get(version) ?? DEFAULT_PHP_INI;
  }

  async savePhpIniContent(version: string, content: string): Promise<PhpOperationResult> {
    try {
      this.emitLog('system', `Saving php.ini for PHP ${version}...`);
      const iniPath = this.getPhpIniPath(version);

      if (iniPath) {
        if (fs.existsSync(iniPath)) {
          const backupPath = `${iniPath}.bak`;
          fs.copyFileSync(iniPath, backupPath);
          this.emitLog('system', `Backup created: ${backupPath}`);
        }

        fs.writeFileSync(iniPath, content, 'utf-8');
        this.emitLog('success', `php.ini saved to ${iniPath}`);
      } else {
        this.phpIniCache.set(version, content);
        this.emitLog('success', `php.ini saved to memory for PHP ${version}`);
      }

      return { success: true, message: 'php.ini saved successfully' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitLog('error', `Failed to save php.ini: ${message}`);
      return { success: false, message: 'Failed to save php.ini', error: message };
    }
  }

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

  async toggleExtension(
    version: string,
    extensionName: string,
    enabled: boolean
  ): Promise<PhpOperationResult> {
    const iniContent = await this.getPhpIniContent(version);

    const updatedContent = enabled
      ? iniContent.replace(new RegExp(`^;extension=${extensionName}`, 'm'), `extension=${extensionName}`)
      : iniContent.replace(new RegExp(`^extension=${extensionName}`, 'm'), `;extension=${extensionName}`);

    await this.savePhpIniContent(version, updatedContent);

    const action = enabled ? 'enabled' : 'disabled';
    this.emitLog('success', `Extension ${extensionName} ${action} for PHP ${version}`);
    return { success: true, message: `Extension ${extensionName} ${action}` };
  }

  async downloadVersion(
    version: string,
    onProgress: (percent: number) => void
  ): Promise<PhpOperationResult> {
    if (this.isVersionInstalled(version)) {
      return { success: false, message: `PHP ${version} is already installed`, error: 'ALREADY_INSTALLED' };
    }

    this.emitLog('system', `Downloading PHP ${version}...`);

    for (let progress = 0; progress <= 100; progress += 5) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 150);
      });
      onProgress(progress);
    }

    const versionDir = this.getVersionDir(version) || this.createVersionDir(version);
    if (versionDir) {
      const iniPath = path.join(versionDir, 'php.ini');
      if (!fs.existsSync(iniPath)) {
        try {
          fs.writeFileSync(iniPath, DEFAULT_PHP_INI, 'utf-8');
        } catch {
          this.phpIniCache.set(version, DEFAULT_PHP_INI);
        }
      }
    } else {
      this.phpIniCache.set(version, DEFAULT_PHP_INI);
    }

    const installed = ConfigStore.getInstalledPhpVersions();
    if (!installed.includes(version)) {
      ConfigStore.setInstalledPhpVersions([...installed, version]);
    }

    this.emitLog('success', `PHP ${version} installed successfully`);
    return { success: true, message: `PHP ${version} installed successfully` };
  }

  async removeVersion(version: string): Promise<PhpOperationResult> {
    if (!this.isVersionInstalled(version)) {
      return { success: false, message: `PHP ${version} is not installed`, error: 'NOT_INSTALLED' };
    }
    if (version === this.activeVersion) {
      return { success: false, message: 'Cannot remove the active PHP version', error: 'IS_ACTIVE' };
    }

    await this.stopPhpCgi(version);

    const installed = ConfigStore.getInstalledPhpVersions();
    ConfigStore.setInstalledPhpVersions(installed.filter((item) => item !== version));
    this.phpIniCache.delete(version);
    this.phpCgiPortMap.delete(version);

    this.emitLog('success', `PHP ${version} removed`);
    return { success: true, message: `PHP ${version} removed successfully` };
  }

  private getPhpCgiPort(version: string): number {
    const parts = version.split('.');
    if (parts.length >= 2) {
      const major = parseInt(parts[0], 10);
      const minor = parseInt(parts[1], 10);
      if (!Number.isNaN(major) && !Number.isNaN(minor)) {
        return 9000 + (major * 100) + minor;
      }
    }
    return 9000;
  }

  private async resolvePhpCgiPort(version: string): Promise<number> {
    const preferredPort = this.getPhpCgiPort(version);
    const preferredAvailable = await isPortAvailable(preferredPort, '127.0.0.1');
    if (preferredAvailable) {
      return preferredPort;
    }

    const fallbackPort = await findAvailablePort(preferredPort + 1, '127.0.0.1', 50);
    this.emitLog(
      'warning',
      `Preferred PHP-CGI port ${preferredPort} is busy for PHP ${version}; using ${fallbackPort}`
    );
    return fallbackPort;
  }

  private getPhpCgiPath(version: string): string | null {
    const versionDir = this.getVersionDir(version);
    const cgiPath = path.join(versionDir, 'php-cgi.exe');
    return fs.existsSync(cgiPath) ? cgiPath : null;
  }

  private getPhpIniPath(version: string): string | null {
    const versionDir = this.getVersionDir(version);
    const candidates = [path.join(versionDir, 'php.ini'), path.join(versionDir, 'php.ini-development')];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    return path.join(versionDir, 'php.ini');
  }

  private scanInstalledVersions(): string[] {
    const versions: string[] = [];

    for (const baseDir of this.getPhpBaseDirs()) {
      if (!fs.existsSync(baseDir)) continue;

      try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const versionDir = path.join(baseDir, entry.name);
          const phpExe = path.join(versionDir, 'php.exe');
          const phpCgiExe = path.join(versionDir, 'php-cgi.exe');
          if (fs.existsSync(phpExe) || fs.existsSync(phpCgiExe)) {
            versions.push(entry.name);
          }
        }
      } catch {
        // Ignore unreadable directories.
      }
    }

    return versions;
  }

  private isVersionInstalled(version: string): boolean {
    const installedOnDisk = this.scanInstalledVersions();
    const installedFromStore = ConfigStore.getInstalledPhpVersions();
    return installedOnDisk.includes(version) || installedFromStore.includes(version);
  }

  private getVersionDir(version: string): string {
    for (const baseDir of this.getPhpBaseDirs()) {
      const versionDir = path.join(baseDir, version);
      if (fs.existsSync(versionDir)) return versionDir;
    }

    return path.join(this.getPhpBaseDirs()[0], version);
  }

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

  private getPhpBaseDirs(): string[] {
    const dirs: string[] = [];
    const savedPath = ConfigStore.getBinaryPath('php');
    if (savedPath) {
      dirs.push(savedPath);
    }

    const appPath =
      (electron as unknown as { app?: { getAppPath?: () => string } }).app?.getAppPath?.() ??
      process.cwd();

    dirs.push(
      path.join(appPath, 'resources', 'binaries', 'php'),
      path.join(process.cwd(), 'resources', 'binaries', 'php')
    );

    return dirs;
  }

  private emitLog(level: string, message: string): void {
    if (this.processManager) {
      this.processManager.broadcastLog(level, message);
    }
    if (this.logEmitter) {
      this.logEmitter(level, message);
    }
  }
}
