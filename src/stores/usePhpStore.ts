/**
 * PHP State Management Store (Zustand)
 *
 * Manages all PHP-related state: versions, php.ini editor content,
 * extensions, loading states, and download progress.
 * Communicates with the Electron main process via IPC when available,
 * falls back to browser-mode mocks otherwise.
 */

import { create } from 'zustand';
import type { PhpVersion, PhpExtension, PhpManagerTab } from '../types/php.types';

/** Default php.ini content for browser-mode development */
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

/** Mock version catalog for browser-mode development */
const MOCK_VERSIONS: PhpVersion[] = [
  { version: '8.5.1', path: 'C:\\devstack\\php\\8.5.1\\php.exe', installed: true, active: true, size: '32 MB' },
  { version: '8.5.0', path: '', installed: false, active: false, size: '32 MB' },
  { version: '8.3.29', path: '', installed: false, active: false, size: '30 MB' },
  { version: '7.4.30', path: '', installed: false, active: false, size: '28 MB' },
  { version: '5.6.9', path: '', installed: false, active: false, size: '24 MB' },
];

/** Mock extensions for browser-mode development */
const MOCK_EXTENSIONS: PhpExtension[] = [
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

/** Shape of the PHP state store */
interface PhpStore {
  // ─── Version State ──────────────────────────────────────────────
  versions: PhpVersion[];
  activeVersion: string;

  // ─── php.ini Editor State ───────────────────────────────────────
  phpIniContent: string;
  phpIniSavedContent: string;
  phpIniModified: boolean;

  // ─── Extension State ────────────────────────────────────────────
  extensions: PhpExtension[];

  // ─── UI State ───────────────────────────────────────────────────
  activeTab: PhpManagerTab;
  loadingVersions: boolean;
  loadingPhpIni: boolean;
  savingPhpIni: boolean;
  downloadingVersion: string | null;
  downloadProgress: number;
  togglingExtension: string | null;

  // ─── Version Actions ────────────────────────────────────────────
  fetchVersions: () => Promise<void>;
  setActiveVersion: (version: string) => Promise<boolean>;
  downloadVersion: (version: string) => Promise<boolean>;
  removeVersion: (version: string) => Promise<boolean>;

  // ─── php.ini Actions ────────────────────────────────────────────
  loadPhpIni: (version: string) => Promise<void>;
  updatePhpIniContent: (content: string) => void;
  savePhpIni: () => Promise<boolean>;
  resetPhpIni: () => void;

  // ─── Extension Actions ──────────────────────────────────────────
  fetchExtensions: (version: string) => Promise<void>;
  toggleExtension: (extensionName: string, enabled: boolean) => Promise<boolean>;

  // ─── UI Actions ─────────────────────────────────────────────────
  setActiveTab: (tab: PhpManagerTab) => void;
}

/** Access the Electron PHP API, if available */
function getPhpApi() {
  return window.electronAPI;
}

export const usePhpStore = create<PhpStore>((set, get) => ({
  // ─── Initial State ──────────────────────────────────────────────
  versions: [],
  activeVersion: '8.5.1',
  phpIniContent: '',
  phpIniSavedContent: '',
  phpIniModified: false,
  extensions: [],
  activeTab: 'versions',
  loadingVersions: false,
  loadingPhpIni: false,
  savingPhpIni: false,
  downloadingVersion: null,
  downloadProgress: 0,
  togglingExtension: null,

  // ─── Version Actions ────────────────────────────────────────────

  fetchVersions: async () => {
    set({ loadingVersions: true });
    try {
      const api = getPhpApi();
      if (api?.phpGetVersions) {
        const versions: PhpVersion[] = await api.phpGetVersions();
        const active = versions.find((v: PhpVersion) => v.active);
        set({
          versions,
          activeVersion: active?.version ?? '8.5.1',
          loadingVersions: false,
        });
      } else {
        // Browser mock fallback
        await new Promise((r) => setTimeout(r, 300));
        set({ versions: [...MOCK_VERSIONS], loadingVersions: false });
      }
    } catch {
      set({ loadingVersions: false });
    }
  },

  setActiveVersion: async (version: string) => {
    const api = getPhpApi();
    try {
      if (api?.phpSetActive) {
        const result = await api.phpSetActive(version);
        if (!result.success) return false;
      } else {
        await new Promise((r) => setTimeout(r, 500));
      }

      // Update local state
      set((state) => ({
        activeVersion: version,
        versions: state.versions.map((v) => ({
          ...v,
          active: v.version === version,
        })),
      }));

      // Reload extensions for the newly active version
      await get().fetchExtensions(version);
      return true;
    } catch {
      return false;
    }
  },

  downloadVersion: async (version: string) => {
    set({ downloadingVersion: version, downloadProgress: 0 });
    try {
      const api = getPhpApi();
      if (api?.phpDownload) {
        // Set up progress listener
        api.onPhpDownloadProgress?.((v: string, progress: number) => {
          if (v === version) {
            set({ downloadProgress: progress });
          }
        });
        const result = await api.phpDownload(version);
        if (!result.success) {
          set({ downloadingVersion: null, downloadProgress: 0 });
          return false;
        }
      } else {
        // Browser mock: simulate download progress
        for (let i = 0; i <= 100; i += 5) {
          await new Promise((r) => setTimeout(r, 150));
          set({ downloadProgress: i });
        }
      }

      // Update version list to reflect the new installation
      set((state) => ({
        downloadingVersion: null,
        downloadProgress: 0,
        versions: state.versions.map((v) =>
          v.version === version
            ? { ...v, installed: true, path: `C:\\devstack\\php\\${version}\\php.exe` }
            : v
        ),
      }));
      return true;
    } catch {
      set({ downloadingVersion: null, downloadProgress: 0 });
      return false;
    }
  },

  removeVersion: async (version: string) => {
    if (version === get().activeVersion) return false;
    const api = getPhpApi();
    try {
      if (api?.phpRemoveVersion) {
        const result = await api.phpRemoveVersion(version);
        if (!result.success) return false;
      }
      set((state) => ({
        versions: state.versions.map((v) =>
          v.version === version ? { ...v, installed: false, path: '', active: false } : v
        ),
      }));
      return true;
    } catch {
      return false;
    }
  },

  // ─── php.ini Actions ────────────────────────────────────────────

  loadPhpIni: async (version: string) => {
    set({ loadingPhpIni: true, phpIniModified: false });
    try {
      const api = getPhpApi();
      let content: string;
      if (api?.phpGetIni) {
        content = await api.phpGetIni(version);
      } else {
        await new Promise((r) => setTimeout(r, 200));
        content = DEFAULT_PHP_INI;
      }
      set({
        phpIniContent: content,
        phpIniSavedContent: content,
        loadingPhpIni: false,
        phpIniModified: false,
      });
    } catch {
      set({ loadingPhpIni: false });
    }
  },

  updatePhpIniContent: (content: string) => {
    set((state) => ({
      phpIniContent: content,
      phpIniModified: content !== state.phpIniSavedContent,
    }));
  },

  savePhpIni: async () => {
    const { activeVersion, phpIniContent } = get();
    set({ savingPhpIni: true });
    try {
      const api = getPhpApi();
      if (api?.phpSaveIni) {
        const result = await api.phpSaveIni(activeVersion, phpIniContent);
        if (!result.success) {
          set({ savingPhpIni: false });
          return false;
        }
      } else {
        await new Promise((r) => setTimeout(r, 300));
      }
      set({
        phpIniSavedContent: phpIniContent,
        phpIniModified: false,
        savingPhpIni: false,
      });
      return true;
    } catch {
      set({ savingPhpIni: false });
      return false;
    }
  },

  resetPhpIni: () => {
    set((state) => ({
      phpIniContent: state.phpIniSavedContent,
      phpIniModified: false,
    }));
  },

  // ─── Extension Actions ──────────────────────────────────────────

  fetchExtensions: async (version: string) => {
    try {
      const api = getPhpApi();
      if (api?.phpGetExtensions) {
        const extensions: PhpExtension[] = await api.phpGetExtensions(version);
        set({ extensions });
      } else {
        await new Promise((r) => setTimeout(r, 200));
        set({ extensions: [...MOCK_EXTENSIONS] });
      }
    } catch {
      // Keep existing extensions on failure
    }
  },

  toggleExtension: async (extensionName: string, enabled: boolean) => {
    set({ togglingExtension: extensionName });
    try {
      const api = getPhpApi();
      const { activeVersion } = get();
      if (api?.phpToggleExtension) {
        const result = await api.phpToggleExtension(activeVersion, extensionName, enabled);
        if (!result.success) {
          set({ togglingExtension: null });
          return false;
        }
      } else {
        await new Promise((r) => setTimeout(r, 300));
      }

      set((state) => ({
        togglingExtension: null,
        extensions: state.extensions.map((ext) =>
          ext.name === extensionName ? { ...ext, enabled } : ext
        ),
      }));
      return true;
    } catch {
      set({ togglingExtension: null });
      return false;
    }
  },

  // ─── UI Actions ─────────────────────────────────────────────────

  setActiveTab: (tab: PhpManagerTab) => {
    set({ activeTab: tab });
  },
}));
