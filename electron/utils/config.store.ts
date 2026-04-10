/**
 * ConfigStore — Persistent Configuration via electron-store
 *
 * Stores user preferences, service ports, active PHP version,
 * installed PHP versions, and binary paths. Survives app restarts.
 *
 * Falls back to sensible defaults if the store is corrupted.
 */

import Store from 'electron-store';

/** Shape of the persisted configuration */
export interface DevStackConfig {
  /** Active PHP version string */
  activePhpVersion: string;
  /** List of installed PHP version strings */
  installedPhpVersions: string[];
  /** Service port assignments */
  ports: {
    apache: number;
    mysql: number;
  };
  /** Binary base paths (absolute) */
  binaryPaths: {
    apache: string;
    mysql: string;
    php: string;
  };
  /** Whether to auto-restart services on crash */
  autoRestart: boolean;
}

/** Default configuration values */
const defaults: DevStackConfig = {
  activePhpVersion: '8.3.29',
  installedPhpVersions: [],
  ports: {
    apache: 80,
    mysql: 3306,
  },
  binaryPaths: {
    apache: '',
    mysql: '',
    php: '',
  },
  autoRestart: false,
};

/**
 * Singleton config store instance.
 * Created lazily to avoid Electron import issues in non-Electron contexts.
 */
let storeInstance: Store<DevStackConfig> | null = null;

function getStore(): Store<DevStackConfig> {
  if (!storeInstance) {
    storeInstance = new Store<DevStackConfig>({
      name: 'devstack-config',
      defaults,
      clearInvalidConfig: true,
    });
  }
  return storeInstance;
}

/** ConfigStore API — wraps electron-store with typed accessors */
export const ConfigStore = {
  /** Get the full configuration */
  getAll(): DevStackConfig {
    try {
      return getStore().store;
    } catch {
      return { ...defaults };
    }
  },

  /** Get a single config value */
  get<K extends keyof DevStackConfig>(key: K): DevStackConfig[K] {
    try {
      return getStore().get(key);
    } catch {
      return defaults[key];
    }
  },

  /** Set a single config value */
  set<K extends keyof DevStackConfig>(key: K, value: DevStackConfig[K]): void {
    try {
      getStore().set(key, value);
    } catch (err) {
      console.error(`[ConfigStore] Failed to set ${key}:`, err);
    }
  },

  /** Update a nested value using dot notation */
  setNested(key: string, value: unknown): void {
    try {
      getStore().set(key, value);
    } catch (err) {
      console.error(`[ConfigStore] Failed to set ${key}:`, err);
    }
  },

  /** Get the active PHP version */
  getActivePhpVersion(): string {
    return ConfigStore.get('activePhpVersion');
  },

  /** Set the active PHP version */
  setActivePhpVersion(version: string): void {
    ConfigStore.set('activePhpVersion', version);
  },

  /** Get installed PHP versions */
  getInstalledPhpVersions(): string[] {
    return ConfigStore.get('installedPhpVersions');
  },

  /** Set installed PHP versions */
  setInstalledPhpVersions(versions: string[]): void {
    ConfigStore.set('installedPhpVersions', versions);
  },

  /** Get service port */
  getPort(service: 'apache' | 'mysql'): number {
    const ports = ConfigStore.get('ports');
    return ports[service];
  },

  /** Set service port */
  setPort(service: 'apache' | 'mysql', port: number): void {
    ConfigStore.setNested(`ports.${service}`, port);
  },

  /** Get binary base path */
  getBinaryPath(service: 'apache' | 'mysql' | 'php'): string {
    const paths = ConfigStore.get('binaryPaths');
    return paths[service];
  },

  /** Set binary base path */
  setBinaryPath(service: 'apache' | 'mysql' | 'php', path: string): void {
    ConfigStore.setNested(`binaryPaths.${service}`, path);
  },

  /** Reset to defaults */
  reset(): void {
    try {
      getStore().clear();
    } catch (err) {
      console.error('[ConfigStore] Failed to reset:', err);
    }
  },
};
