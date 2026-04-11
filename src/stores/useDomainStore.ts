/**
 * Domains store (Zustand)
 *
 * Handles domain/vhost CRUD flows through Electron IPC.
 */

import { create } from 'zustand';
import type { DomainInput, DomainOperationResult, DomainRecord } from '../types/domain.types';

interface BrowserOpenResult {
  success: boolean;
  message: string;
  error?: string;
}

interface DomainStore {
  domains: DomainRecord[];
  installedPhpVersions: string[];
  loadingDomains: boolean;
  loadingPhpVersions: boolean;
  submittingDomain: boolean;
  deletingDomainId: string | null;

  fetchDomains: () => Promise<void>;
  fetchInstalledPhpVersions: () => Promise<void>;
  createDomain: (payload: DomainInput) => Promise<DomainOperationResult>;
  updateDomain: (id: string, payload: DomainInput) => Promise<DomainOperationResult>;
  deleteDomain: (id: string) => Promise<DomainOperationResult>;
  openDomain: (hostname: string) => Promise<BrowserOpenResult>;
  pickProjectPath: () => Promise<string | null>;
}

function sortDomains(domains: DomainRecord[]): DomainRecord[] {
  return [...domains].sort((a, b) => a.hostname.localeCompare(b.hostname));
}

export const useDomainStore = create<DomainStore>((set) => ({
  domains: [],
  installedPhpVersions: [],
  loadingDomains: false,
  loadingPhpVersions: false,
  submittingDomain: false,
  deletingDomainId: null,

  fetchDomains: async () => {
    set({ loadingDomains: true });
    try {
      if (!window.electronAPI?.domainsList) {
        set({ loadingDomains: false, domains: [] });
        return;
      }

      const domains = await window.electronAPI.domainsList();
      set({ domains: sortDomains(domains), loadingDomains: false });
    } catch {
      set({ loadingDomains: false });
    }
  },

  fetchInstalledPhpVersions: async () => {
    set({ loadingPhpVersions: true });
    try {
      if (!window.electronAPI?.phpGetVersions) {
        set({ installedPhpVersions: [], loadingPhpVersions: false });
        return;
      }

      const versions = await window.electronAPI.phpGetVersions();
      const installed = versions
        .filter((version) => version.installed)
        .map((version) => version.version)
        .sort((a, b) => b.localeCompare(a));

      set({ installedPhpVersions: installed, loadingPhpVersions: false });
    } catch {
      set({ loadingPhpVersions: false });
    }
  },

  createDomain: async (payload: DomainInput) => {
    if (!window.electronAPI?.domainsCreate) {
      return {
        success: false,
        message: 'Domains API is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
      };
    }

    set({ submittingDomain: true });
    try {
      const result = await window.electronAPI.domainsCreate(payload);
      if (result.success && result.domain) {
        set((state) => ({
          submittingDomain: false,
          domains: sortDomains([...state.domains, result.domain!]),
        }));
      } else {
        set({ submittingDomain: false });
      }

      return result;
    } catch (error) {
      set({ submittingDomain: false });
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Failed to create domain', error: message };
    }
  },

  updateDomain: async (id: string, payload: DomainInput) => {
    if (!window.electronAPI?.domainsUpdate) {
      return {
        success: false,
        message: 'Domains API is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
      };
    }

    set({ submittingDomain: true });
    try {
      const result = await window.electronAPI.domainsUpdate(id, payload);
      if (result.success && result.domain) {
        set((state) => ({
          submittingDomain: false,
          domains: sortDomains(
            state.domains.map((domain) => (domain.id === id ? result.domain! : domain))
          ),
        }));
      } else {
        set({ submittingDomain: false });
      }

      return result;
    } catch (error) {
      set({ submittingDomain: false });
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Failed to update domain', error: message };
    }
  },

  deleteDomain: async (id: string) => {
    if (!window.electronAPI?.domainsDelete) {
      return {
        success: false,
        message: 'Domains API is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
      };
    }

    set({ deletingDomainId: id });
    try {
      const result = await window.electronAPI.domainsDelete(id);
      if (result.success) {
        set((state) => ({
          deletingDomainId: null,
          domains: state.domains.filter((domain) => domain.id !== id),
        }));
      } else {
        set({ deletingDomainId: null });
      }

      return result;
    } catch (error) {
      set({ deletingDomainId: null });
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Failed to delete domain', error: message };
    }
  },

  openDomain: async (hostname: string) => {
    if (!window.electronAPI?.domainsOpen) {
      return {
        success: false,
        message: 'Domains API is unavailable outside Electron mode',
        error: 'IPC_UNAVAILABLE',
      };
    }

    try {
      return await window.electronAPI.domainsOpen(hostname);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: 'Failed to open domain in browser', error: message };
    }
  },

  pickProjectPath: async () => {
    if (!window.electronAPI?.domainsPickProjectPath) return null;

    try {
      return await window.electronAPI.domainsPickProjectPath();
    } catch {
      return null;
    }
  },
}));
