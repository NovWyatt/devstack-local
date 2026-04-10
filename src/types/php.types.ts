/**
 * PHP-related type definitions for DevStack Local.
 * Used by the PHP Manager components, store, and Electron service.
 */

/** Represents a PHP version entry (installed or available for download) */
export interface PhpVersion {
  /** Semantic version string, e.g. "8.5.1" */
  version: string;
  /** Full path to the php.exe binary (empty if not installed) */
  path: string;
  /** Whether this version is installed locally */
  installed: boolean;
  /** Whether this is the currently active version */
  active: boolean;
  /** Download size display string, e.g. "32 MB" */
  size: string;
  /** URL to download the PHP zip archive */
  downloadUrl?: string;
}

/** Represents a PHP extension that can be toggled in php.ini */
export interface PhpExtension {
  /** Extension identifier, e.g. "mysqli" */
  name: string;
  /** Whether the extension is currently enabled in php.ini */
  enabled: boolean;
  /** Whether this is a core/required extension (cannot be disabled) */
  required: boolean;
  /** Human-readable description of the extension */
  description: string;
}

/** Result of a PHP operation (version switch, ini save, etc.) */
export interface PhpOperationResult {
  success: boolean;
  message: string;
  error?: string;
}

/** Active tab in the PHP Manager page */
export type PhpManagerTab = 'versions' | 'phpini' | 'extensions';
