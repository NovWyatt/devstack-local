/**
 * ConfigStore — Persistent Configuration via electron-store
 *
 * Stores user preferences, service ports, active PHP version,
 * installed PHP versions, and binary paths. Survives app restarts.
 *
 * Falls back to sensible defaults if the store is corrupted.
 */
import Store from 'electron-store';
/** Default configuration values */
const defaults = {
    activePhpVersion: '8.3.30',
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
    domains: [],
    remoteConnections: [],
    remoteSensitiveSecrets: [],
};
/**
 * Singleton config store instance.
 * Created lazily to avoid Electron import issues in non-Electron contexts.
 */
let storeInstance = null;
function getStore() {
    if (!storeInstance) {
        storeInstance = new Store({
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
    getAll() {
        try {
            return getStore().store;
        }
        catch {
            return { ...defaults };
        }
    },
    /** Get a single config value */
    get(key) {
        try {
            return getStore().get(key);
        }
        catch {
            return defaults[key];
        }
    },
    /** Set a single config value */
    set(key, value) {
        try {
            getStore().set(key, value);
        }
        catch (err) {
            console.error(`[ConfigStore] Failed to set ${key}:`, err);
        }
    },
    /** Update a nested value using dot notation */
    setNested(key, value) {
        try {
            getStore().set(key, value);
        }
        catch (err) {
            console.error(`[ConfigStore] Failed to set ${key}:`, err);
        }
    },
    /** Get the active PHP version */
    getActivePhpVersion() {
        return ConfigStore.get('activePhpVersion');
    },
    /** Set the active PHP version */
    setActivePhpVersion(version) {
        ConfigStore.set('activePhpVersion', version);
    },
    /** Get installed PHP versions */
    getInstalledPhpVersions() {
        return ConfigStore.get('installedPhpVersions');
    },
    /** Set installed PHP versions */
    setInstalledPhpVersions(versions) {
        ConfigStore.set('installedPhpVersions', versions);
    },
    /** Get service port */
    getPort(service) {
        const ports = ConfigStore.get('ports');
        return ports[service];
    },
    /** Set service port */
    setPort(service, port) {
        ConfigStore.setNested(`ports.${service}`, port);
    },
    /** Get binary base path */
    getBinaryPath(service) {
        const paths = ConfigStore.get('binaryPaths');
        return paths[service];
    },
    /** Set binary base path */
    setBinaryPath(service, path) {
        ConfigStore.setNested(`binaryPaths.${service}`, path);
    },
    /** Reset to defaults */
    reset() {
        try {
            getStore().clear();
        }
        catch (err) {
            console.error('[ConfigStore] Failed to reset:', err);
        }
    },
    /** Get persisted domain list */
    getDomains() {
        return ConfigStore.get('domains');
    },
    /** Persist domain list */
    setDomains(domains) {
        ConfigStore.set('domains', domains);
    },
    /** Get remote connection metadata */
    getRemoteConnections() {
        return ConfigStore.get('remoteConnections');
    },
    /** Persist remote connection metadata */
    setRemoteConnections(connections) {
        ConfigStore.set('remoteConnections', connections);
    },
    /** Get encrypted remote secrets */
    getRemoteSensitiveSecrets() {
        return ConfigStore.get('remoteSensitiveSecrets');
    },
    /** Persist encrypted remote secrets */
    setRemoteSensitiveSecrets(secrets) {
        ConfigStore.set('remoteSensitiveSecrets', secrets);
    },
};
