/**
 * DatabaseManager
 *
 * Minimal MySQL database management UI for Phase 4.1.
 */

import { useEffect, useRef, useState } from 'react';
import { Database, Download, Loader2, Plus, RefreshCw, Shield, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useDatabaseStore } from '../../stores/useDatabaseStore';

const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

function isSystemDatabase(database: string): boolean {
  return SYSTEM_DATABASES.has(database.toLowerCase());
}

function isUserCancelled(error?: string): boolean {
  return error === 'CANCELLED';
}

export function DatabaseManager() {
  const databases = useDatabaseStore((state) => state.databases);
  const loadingDatabases = useDatabaseStore((state) => state.loadingDatabases);
  const creatingDatabase = useDatabaseStore((state) => state.creatingDatabase);
  const deletingDatabase = useDatabaseStore((state) => state.deletingDatabase);
  const importingDatabase = useDatabaseStore((state) => state.importingDatabase);
  const exportingDatabase = useDatabaseStore((state) => state.exportingDatabase);
  const fetchDatabases = useDatabaseStore((state) => state.fetchDatabases);
  const createDatabase = useDatabaseStore((state) => state.createDatabase);
  const deleteDatabase = useDatabaseStore((state) => state.deleteDatabase);
  const importDatabase = useDatabaseStore((state) => state.importDatabase);
  const exportDatabase = useDatabaseStore((state) => state.exportDatabase);

  const hasInitialized = useRef(false);
  const [newDatabaseName, setNewDatabaseName] = useState('');

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    void fetchDatabases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateDatabase = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newDatabaseName.trim();
    if (!name) {
      toast.error('Database name is required');
      return;
    }

    const result = await createDatabase(name);
    if (result.success) {
      toast.success(result.message);
      setNewDatabaseName('');
      return;
    }

    toast.error(result.error ?? result.message);
  };

  const handleDeleteDatabase = async (databaseName: string) => {
    if (isSystemDatabase(databaseName)) return;

    const confirmed = window.confirm(`Delete database "${databaseName}"? This cannot be undone.`);
    if (!confirmed) return;

    const result = await deleteDatabase(databaseName);
    if (result.success) {
      toast.success(result.message);
      return;
    }

    toast.error(result.error ?? result.message);
  };

  const handleImportDatabase = async (databaseName: string) => {
    const result = await importDatabase(databaseName);
    if (result.success) {
      toast.success(result.message);
      return;
    }

    if (isUserCancelled(result.error)) return;
    toast.error(result.error ?? result.message);
  };

  const handleExportDatabase = async (databaseName: string) => {
    const result = await exportDatabase(databaseName);
    if (result.success) {
      toast.success(result.filePath ? `${result.message} (${result.filePath})` : result.message);
      return;
    }

    if (isUserCancelled(result.error)) return;
    toast.error(result.error ?? result.message);
  };

  const refreshDatabases = async () => {
    const result = await fetchDatabases();
    if (!result.success) {
      toast.error(result.error ?? result.message);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent-blue/15">
          <Database size={20} className="text-accent-blue" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Database Manager</h1>
          <p className="text-sm text-text-muted">
            Manage local MySQL databases with create, delete, import, and export.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-2 rounded-xl border border-border-color bg-bg-card p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-4">Create Database</h2>
          <form onSubmit={handleCreateDatabase} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="database-name"
                className="text-xs font-semibold uppercase tracking-wider text-text-muted"
              >
                Database Name
              </label>
              <input
                id="database-name"
                value={newDatabaseName}
                onChange={(event) => setNewDatabaseName(event.target.value)}
                placeholder="my_project_db"
                className="w-full rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                maxLength={64}
                required
              />
              <p className="text-xs text-text-muted">
                Allowed characters: letters, numbers, and underscore.
              </p>
            </div>

            <button
              type="submit"
              disabled={creatingDatabase}
              className={cn(
                'w-full flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all',
                'bg-accent-blue/15 text-accent-blue border-accent-blue/30 hover:bg-accent-blue/25',
                'disabled:opacity-60 disabled:cursor-not-allowed'
              )}
            >
              {creatingDatabase ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus size={15} />
                  Create Database
                </>
              )}
            </button>
          </form>
        </div>

        <div className="xl:col-span-3 rounded-xl border border-border-color bg-bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-text-primary">Available Databases</h2>
              <span className="text-xs text-text-muted">{databases.length} total</span>
            </div>
            <button
              onClick={refreshDatabases}
              disabled={loadingDatabases}
              className="flex items-center gap-1.5 rounded-md border border-border-color px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
            >
              {loadingDatabases ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Refresh
            </button>
          </div>

          {loadingDatabases ? (
            <div className="flex items-center justify-center py-14">
              <Loader2 size={22} className="animate-spin text-accent-blue" />
              <span className="ml-3 text-sm text-text-muted">Loading databases...</span>
            </div>
          ) : databases.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-color p-8 text-center">
              <p className="text-sm text-text-muted">No databases found.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {databases.map((databaseName) => {
                const system = isSystemDatabase(databaseName);
                const isDeleting = deletingDatabase === databaseName;
                const isImporting = importingDatabase === databaseName;
                const isExporting = exportingDatabase === databaseName;
                const disableActions = isDeleting || isImporting || isExporting;

                return (
                  <div
                    key={databaseName}
                    className="rounded-lg border border-border-color bg-bg-secondary/50 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary break-all">{databaseName}</p>
                        {system && (
                          <div className="mt-1 inline-flex items-center gap-1 rounded border border-accent-orange/30 bg-accent-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-orange">
                            <Shield size={10} />
                            System Database
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleImportDatabase(databaseName)}
                          disabled={disableActions}
                          className="flex items-center justify-center w-8 h-8 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
                          title="Import SQL"
                        >
                          {isImporting ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Upload size={14} />
                          )}
                        </button>
                        <button
                          onClick={() => handleExportDatabase(databaseName)}
                          disabled={disableActions}
                          className="flex items-center justify-center w-8 h-8 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
                          title="Export SQL"
                        >
                          {isExporting ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Download size={14} />
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteDatabase(databaseName)}
                          disabled={system || disableActions}
                          className="flex items-center justify-center w-8 h-8 rounded-md text-status-stopped/80 hover:text-status-stopped hover:bg-status-stopped/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          title={system ? 'System databases cannot be deleted' : 'Delete database'}
                        >
                          {isDeleting ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
