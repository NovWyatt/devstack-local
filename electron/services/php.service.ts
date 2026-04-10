/**
 * PHP Version Manager Service (Semi-Mock Implementation)
 *
 * Manages PHP versions, php.ini configuration, and extensions.
 * For Phase 2, version scanning and ini editing are semi-real
 * (operating on mock files), while downloads are fully simulated.
 */

import type { PhpVersion, PhpExtension, PhpOperationResult } from '../../src/types/php.types';

/** Callback for emitting log messages to the main process */
type LogEmitter = (level: string, message: string) => void;

/** Default php.ini content used when creating mock installations */
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

/** Catalog of all known PHP versions available for management */
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
  private activeVersion: string = '8.5.1';
  private logEmitter: LogEmitter | null = null;

  /**
   * In-memory storage for installed versions and their php.ini content.
   * In a real implementation, these would be read from disk.
   */
  private installedVersions: Set<string> = new Set(['8.5.1']);
  private phpIniStore: Map<string, string> = new Map([['8.5.1', DEFAULT_PHP_INI]]);

  /** Register a log emitter callback for broadcasting messages */
  setLogEmitter(emitter: LogEmitter): void {
    this.logEmitter = emitter;
  }

  /**
   * Get the list of all available PHP versions (installed and downloadable).
   * Merges the version catalog with installation state.
   */
  async getAvailableVersions(): Promise<PhpVersion[]> {
    return VERSION_CATALOG.map((v) => ({
      version: v.version,
      path: this.installedVersions.has(v.version)
        ? `C:\\devstack\\php\\${v.version}\\php.exe`
        : '',
      installed: this.installedVersions.has(v.version),
      active: v.version === this.activeVersion,
      size: v.size,
      downloadUrl: `https://windows.php.net/downloads/releases/php-${v.version}-Win32-vs16-x64.zip`,
    }));
  }

  /**
   * Set the active PHP version.
   * The version must be installed before it can be activated.
   */
  async setActiveVersion(version: string): Promise<PhpOperationResult> {
    if (!this.installedVersions.has(version)) {
      return { success: false, message: `PHP ${version} is not installed`, error: 'NOT_INSTALLED' };
    }

    const previousVersion = this.activeVersion;
    this.activeVersion = version;

    this.emitLog('system', `Switching PHP version from ${previousVersion} to ${version}...`);

    // Simulate a brief delay for the version switch
    await new Promise((resolve) => setTimeout(resolve, 500));

    this.emitLog('success', `PHP ${version} is now active`);

    return { success: true, message: `PHP ${version} activated successfully` };
  }

  /** Get the currently active PHP version string */
  getActiveVersion(): string {
    return this.activeVersion;
  }

  /**
   * Get php.ini content for a specific version.
   * Returns the stored content or the default template if none exists.
   */
  async getPhpIniContent(version: string): Promise<string> {
    return this.phpIniStore.get(version) ?? DEFAULT_PHP_INI;
  }

  /**
   * Save php.ini content for a specific version.
   * Creates a backup of the previous content before overwriting.
   */
  async savePhpIniContent(version: string, content: string): Promise<PhpOperationResult> {
    try {
      this.emitLog('system', `Saving php.ini for PHP ${version}...`);

      // Simulate write delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      this.phpIniStore.set(version, content);

      this.emitLog('success', `php.ini saved for PHP ${version}`);
      return { success: true, message: 'php.ini saved successfully' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.emitLog('error', `Failed to save php.ini: ${msg}`);
      return { success: false, message: 'Failed to save php.ini', error: msg };
    }
  }

  /**
   * Get the list of extensions for a specific version.
   * Parses the stored php.ini content to determine which extensions are enabled.
   */
  async getExtensions(version: string): Promise<PhpExtension[]> {
    const iniContent = this.phpIniStore.get(version) ?? DEFAULT_PHP_INI;

    return COMMON_EXTENSIONS.map((ext) => {
      // Check if the extension line is uncommented (enabled) in php.ini
      const enabledPattern = new RegExp(`^extension=${ext.name}\\s*$`, 'm');
      const disabledPattern = new RegExp(`^;extension=${ext.name}\\s*$`, 'm');

      let enabled = ext.enabled; // default from catalog
      if (enabledPattern.test(iniContent)) {
        enabled = true;
      } else if (disabledPattern.test(iniContent)) {
        enabled = false;
      }

      return { ...ext, enabled };
    });
  }

  /**
   * Toggle a PHP extension on or off by modifying the php.ini content.
   * Comments or uncomments the relevant extension= line.
   */
  async toggleExtension(
    version: string,
    extensionName: string,
    enabled: boolean
  ): Promise<PhpOperationResult> {
    const iniContent = this.phpIniStore.get(version) ?? DEFAULT_PHP_INI;

    let updatedContent: string;
    if (enabled) {
      // Uncomment: ;extension=name → extension=name
      updatedContent = iniContent.replace(
        new RegExp(`^;extension=${extensionName}`, 'm'),
        `extension=${extensionName}`
      );
    } else {
      // Comment: extension=name → ;extension=name
      updatedContent = iniContent.replace(
        new RegExp(`^extension=${extensionName}`, 'm'),
        `;extension=${extensionName}`
      );
    }

    this.phpIniStore.set(version, updatedContent);

    const action = enabled ? 'enabled' : 'disabled';
    this.emitLog('success', `Extension ${extensionName} ${action} for PHP ${version}`);

    return {
      success: true,
      message: `Extension ${extensionName} ${action}`,
    };
  }

  /**
   * Simulate downloading and installing a PHP version.
   * Sends progress updates via the provided callback.
   */
  async downloadVersion(
    version: string,
    onProgress: (percent: number) => void
  ): Promise<PhpOperationResult> {
    if (this.installedVersions.has(version)) {
      return { success: false, message: `PHP ${version} is already installed`, error: 'ALREADY_INSTALLED' };
    }

    this.emitLog('system', `Downloading PHP ${version}...`);

    // Simulate download progress in 5% increments
    for (let i = 0; i <= 100; i += 5) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      onProgress(i);
    }

    // "Install" the version
    this.installedVersions.add(version);
    this.phpIniStore.set(version, DEFAULT_PHP_INI);

    this.emitLog('success', `PHP ${version} installed successfully`);

    return { success: true, message: `PHP ${version} installed successfully` };
  }

  /**
   * Remove an installed PHP version.
   * Cannot remove the currently active version.
   */
  async removeVersion(version: string): Promise<PhpOperationResult> {
    if (!this.installedVersions.has(version)) {
      return { success: false, message: `PHP ${version} is not installed`, error: 'NOT_INSTALLED' };
    }
    if (version === this.activeVersion) {
      return { success: false, message: 'Cannot remove the active PHP version', error: 'IS_ACTIVE' };
    }

    this.installedVersions.delete(version);
    this.phpIniStore.delete(version);

    this.emitLog('success', `PHP ${version} removed`);
    return { success: true, message: `PHP ${version} removed successfully` };
  }

  /** Emit a log message through the registered emitter */
  private emitLog(level: string, message: string): void {
    if (this.logEmitter) {
      this.logEmitter(level, message);
    }
  }
}
