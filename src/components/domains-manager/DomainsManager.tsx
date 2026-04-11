/**
 * DomainsManager
 *
 * UI for managing local domains + Apache virtual hosts.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  FolderOpen,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useDomainStore } from '../../stores/useDomainStore';
import type { DomainInput, DomainRecord } from '../../types/domain.types';

interface DomainFormState {
  hostname: string;
  projectPath: string;
  phpVersion: string;
}

const INITIAL_FORM: DomainFormState = {
  hostname: '',
  projectPath: '',
  phpVersion: '',
};

export function DomainsManager() {
  const domains = useDomainStore((state) => state.domains);
  const installedPhpVersions = useDomainStore((state) => state.installedPhpVersions);
  const loadingDomains = useDomainStore((state) => state.loadingDomains);
  const loadingPhpVersions = useDomainStore((state) => state.loadingPhpVersions);
  const submittingDomain = useDomainStore((state) => state.submittingDomain);
  const deletingDomainId = useDomainStore((state) => state.deletingDomainId);
  const fetchDomains = useDomainStore((state) => state.fetchDomains);
  const fetchInstalledPhpVersions = useDomainStore((state) => state.fetchInstalledPhpVersions);
  const createDomain = useDomainStore((state) => state.createDomain);
  const updateDomain = useDomainStore((state) => state.updateDomain);
  const deleteDomain = useDomainStore((state) => state.deleteDomain);
  const openDomain = useDomainStore((state) => state.openDomain);
  const pickProjectPath = useDomainStore((state) => state.pickProjectPath);

  const [form, setForm] = useState<DomainFormState>(INITIAL_FORM);
  const [editingDomainId, setEditingDomainId] = useState<string | null>(null);
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    void fetchDomains();
    void fetchInstalledPhpVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isEditing = !!editingDomainId;

  const handleInputChange = (key: keyof DomainFormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setForm(INITIAL_FORM);
    setEditingDomainId(null);
  };

  const buildPayload = (): DomainInput => {
    return {
      hostname: form.hostname,
      projectPath: form.projectPath,
      phpVersion: form.phpVersion.trim() ? form.phpVersion.trim() : null,
    };
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = buildPayload();
    const result = isEditing && editingDomainId
      ? await updateDomain(editingDomainId, payload)
      : await createDomain(payload);

    if (result.success) {
      toast.success(result.message);
      resetForm();
      await fetchDomains();
      return;
    }

    toast.error(result.error ?? result.message);
  };

  const handleBrowseProjectPath = async () => {
    const selectedPath = await pickProjectPath();
    if (!selectedPath) return;
    handleInputChange('projectPath', selectedPath);
  };

  const startEditing = (domain: DomainRecord) => {
    setEditingDomainId(domain.id);
    setForm({
      hostname: domain.hostname,
      projectPath: domain.projectPath,
      phpVersion: domain.phpVersion ?? '',
    });
  };

  const handleDeleteDomain = async (domain: DomainRecord) => {
    const confirmed = window.confirm(`Delete domain "${domain.hostname}"?`);
    if (!confirmed) return;

    const result = await deleteDomain(domain.id);
    if (result.success) {
      toast.success(result.message);
      if (editingDomainId === domain.id) {
        resetForm();
      }
      return;
    }

    toast.error(result.error ?? result.message);
  };

  const handleOpenDomain = async (domain: DomainRecord) => {
    const result = await openDomain(domain.hostname);
    if (result.success) {
      toast.success(result.message);
      return;
    }

    toast.error(result.error ?? result.message);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent-blue/15">
          <Globe size={20} className="text-accent-blue" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Domains & Virtual Hosts</h1>
          <p className="text-sm text-text-muted">
            Manage local hostnames, hosts file entries, and Apache vhost mappings.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-2 rounded-xl border border-border-color bg-bg-card p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-4">
            {isEditing ? 'Edit Domain' : 'Add New Domain'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="domain-hostname" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Hostname
              </label>
              <input
                id="domain-hostname"
                value={form.hostname}
                onChange={(event) => handleInputChange('hostname', event.target.value)}
                placeholder="my-project.test"
                className="w-full rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="domain-project-path" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Project Path
              </label>
              <div className="flex gap-2">
                <input
                  id="domain-project-path"
                  value={form.projectPath}
                  onChange={(event) => handleInputChange('projectPath', event.target.value)}
                  placeholder="C:\\Projects\\my-project\\public"
                  className="flex-1 rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                  required
                />
                <button
                  type="button"
                  onClick={handleBrowseProjectPath}
                  className="flex items-center justify-center px-3 rounded-lg border border-border-color text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all"
                  title="Select folder"
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="domain-php-version" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                PHP Version (Optional)
              </label>
              <select
                id="domain-php-version"
                value={form.phpVersion}
                onChange={(event) => handleInputChange('phpVersion', event.target.value)}
                className="w-full rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                disabled={loadingPhpVersions}
              >
                <option value="">None (static or external handler)</option>
                {installedPhpVersions.map((version) => (
                  <option key={version} value={version}>
                    PHP {version}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={submittingDomain}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all',
                  'bg-accent-blue/15 text-accent-blue border-accent-blue/30 hover:bg-accent-blue/25',
                  'disabled:opacity-60 disabled:cursor-not-allowed'
                )}
              >
                {submittingDomain ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Saving...
                  </>
                ) : isEditing ? (
                  <>
                    <Save size={15} />
                    Update Domain
                  </>
                ) : (
                  <>
                    <Plus size={15} />
                    Add Domain
                  </>
                )}
              </button>

              {isEditing && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex items-center justify-center gap-2 rounded-lg border border-border-color px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all"
                >
                  <X size={15} />
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="xl:col-span-3 rounded-xl border border-border-color bg-bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-text-primary">Configured Domains</h2>
            <span className="text-xs text-text-muted">{domains.length} total</span>
          </div>

          {loadingDomains ? (
            <div className="flex items-center justify-center py-14">
              <Loader2 size={22} className="animate-spin text-accent-blue" />
              <span className="ml-3 text-sm text-text-muted">Loading domains...</span>
            </div>
          ) : domains.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-color p-8 text-center">
              <p className="text-sm text-text-muted">No domains configured yet.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {domains.map((domain) => (
                <div
                  key={domain.id}
                  className="rounded-lg border border-border-color bg-bg-secondary/50 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="text-sm font-semibold text-text-primary">{domain.hostname}</span>
                        {domain.phpVersion ? (
                          <span className="px-2 py-0.5 rounded border border-accent-blue/30 bg-accent-blue/15 text-[10px] font-semibold uppercase tracking-wider text-accent-blue">
                            PHP {domain.phpVersion}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded border border-border-color text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                            No PHP Override
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-mono text-text-muted break-all">
                        {domain.projectPath}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenDomain(domain)}
                        className="flex items-center justify-center w-8 h-8 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all"
                        title="Open in browser"
                      >
                        <ExternalLink size={14} />
                      </button>
                      <button
                        onClick={() => startEditing(domain)}
                        className="flex items-center justify-center w-8 h-8 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteDomain(domain)}
                        disabled={deletingDomainId === domain.id}
                        className="flex items-center justify-center w-8 h-8 rounded-md text-status-stopped/80 hover:text-status-stopped hover:bg-status-stopped/10 transition-all disabled:opacity-60"
                        title="Delete"
                      >
                        {deletingDomainId === domain.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
