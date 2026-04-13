/**
 * DatabaseManager
 *
 * MySQL database management + safe table browser + SQL console for Phase 4.3.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Database,
  Download,
  History,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Shield,
  Table2,
  TerminalSquare,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useDatabaseStore } from '../../stores/useDatabaseStore';

const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
const SQL_WRITE_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE']);
const SQL_DANGEROUS_WRITE_KEYWORDS = new Set(['UPDATE', 'DELETE']);
const SQL_HISTORY_MAX_ITEMS = 20;
type DatabasePanelTab = 'browser' | 'sql';
type PendingWriteQuery = {
  databaseName: string;
  sql: string;
  keyword: 'UPDATE' | 'DELETE';
};

function isSystemDatabase(database: string): boolean {
  return SYSTEM_DATABASES.has(database.toLowerCase());
}

function isUserCancelled(error?: string): boolean {
  return error === 'CANCELLED';
}

function isRowFetchCancelled(error?: string): boolean {
  return error === 'ROW_FETCH_CANCELLED';
}

function getSqlKeyword(sql: string): string {
  const normalized = sql.trim();
  if (!normalized) return '';
  const match = normalized.match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : '';
}

function getHistoryLabel(sql: string): string {
  const singleLine = sql.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= 96) {
    return singleLine;
  }
  return `${singleLine.slice(0, 93)}...`;
}

const ROWS_LIMIT_OPTIONS = [25, 50, 100];

export function DatabaseManager() {
  const databases = useDatabaseStore((state) => state.databases);
  const tables = useDatabaseStore((state) => state.tables);
  const selectedDatabase = useDatabaseStore((state) => state.selectedDatabase);
  const selectedTable = useDatabaseStore((state) => state.selectedTable);
  const schemaColumns = useDatabaseStore((state) => state.schemaColumns);
  const rowColumns = useDatabaseStore((state) => state.rowColumns);
  const rows = useDatabaseStore((state) => state.rows);
  const rowsPage = useDatabaseStore((state) => state.rowsPage);
  const rowsLimit = useDatabaseStore((state) => state.rowsLimit);
  const rowsHasMore = useDatabaseStore((state) => state.rowsHasMore);
  const loadingDatabases = useDatabaseStore((state) => state.loadingDatabases);
  const loadingTables = useDatabaseStore((state) => state.loadingTables);
  const loadingSchema = useDatabaseStore((state) => state.loadingSchema);
  const loadingRows = useDatabaseStore((state) => state.loadingRows);
  const runningQuery = useDatabaseStore((state) => state.runningQuery);
  const browserError = useDatabaseStore((state) => state.browserError);
  const queryResult = useDatabaseStore((state) => state.queryResult);
  const queryError = useDatabaseStore((state) => state.queryError);
  const creatingDatabase = useDatabaseStore((state) => state.creatingDatabase);
  const deletingDatabase = useDatabaseStore((state) => state.deletingDatabase);
  const importingDatabase = useDatabaseStore((state) => state.importingDatabase);
  const exportingDatabase = useDatabaseStore((state) => state.exportingDatabase);
  const exportingTableCsv = useDatabaseStore((state) => state.exportingTableCsv);
  const fetchDatabases = useDatabaseStore((state) => state.fetchDatabases);
  const selectDatabase = useDatabaseStore((state) => state.selectDatabase);
  const selectTable = useDatabaseStore((state) => state.selectTable);
  const fetchTables = useDatabaseStore((state) => state.fetchTables);
  const fetchTableSchema = useDatabaseStore((state) => state.fetchTableSchema);
  const fetchTableRows = useDatabaseStore((state) => state.fetchTableRows);
  const executeSqlQuery = useDatabaseStore((state) => state.executeSqlQuery);
  const clearSqlQueryState = useDatabaseStore((state) => state.clearSqlQueryState);
  const createDatabase = useDatabaseStore((state) => state.createDatabase);
  const deleteDatabase = useDatabaseStore((state) => state.deleteDatabase);
  const importDatabase = useDatabaseStore((state) => state.importDatabase);
  const exportDatabase = useDatabaseStore((state) => state.exportDatabase);
  const exportTableCsv = useDatabaseStore((state) => state.exportTableCsv);

  const hasInitialized = useRef(false);
  const [newDatabaseName, setNewDatabaseName] = useState('');
  const [activeTab, setActiveTab] = useState<DatabasePanelTab>('browser');
  const [sqlDatabase, setSqlDatabase] = useState('');
  const [sqlInput, setSqlInput] = useState('SELECT NOW() AS server_time');
  const [sqlHistory, setSqlHistory] = useState<string[]>([]);
  const [selectedHistorySql, setSelectedHistorySql] = useState('');
  const [pendingWriteQuery, setPendingWriteQuery] = useState<PendingWriteQuery | null>(null);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    void fetchDatabases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (databases.length === 0) {
      setSqlDatabase('');
      return;
    }

    setSqlDatabase((current) => {
      if (current && databases.includes(current)) {
        return current;
      }
      if (selectedDatabase && databases.includes(selectedDatabase)) {
        return selectedDatabase;
      }
      return databases[0];
    });
  }, [databases, selectedDatabase]);

  const refreshDatabases = async () => {
    const result = await fetchDatabases();
    if (!result.success) {
      toast.error(result.error ?? result.message);
    }
  };

  const handleSelectDatabase = async (databaseName: string) => {
    if (databaseName === selectedDatabase) return;
    selectDatabase(databaseName);
    const result = await fetchTables(databaseName);
    if (!result.success) {
      toast.error(result.error ?? result.message);
    }
  };

  const refreshTables = async () => {
    if (!selectedDatabase) return;
    const result = await fetchTables(selectedDatabase);
    if (!result.success) {
      toast.error(result.error ?? result.message);
    }
  };

  const handleSelectTable = async (tableName: string) => {
    if (!selectedDatabase || tableName === selectedTable) return;
    selectTable(tableName);
    const schemaResult = await fetchTableSchema(selectedDatabase, tableName);
    if (!schemaResult.success) {
      toast.error(schemaResult.error ?? schemaResult.message);
      return;
    }

    const rowsResult = await fetchTableRows(selectedDatabase, tableName, 1, rowsLimit);
    if (!rowsResult.success && !isRowFetchCancelled(rowsResult.error)) {
      toast.error(rowsResult.error ?? rowsResult.message);
    }
  };

  const refreshSelectedTable = async () => {
    if (!selectedDatabase || !selectedTable) return;
    const schemaResult = await fetchTableSchema(selectedDatabase, selectedTable);
    if (!schemaResult.success) {
      toast.error(schemaResult.error ?? schemaResult.message);
      return;
    }

    const rowsResult = await fetchTableRows(selectedDatabase, selectedTable, rowsPage, rowsLimit);
    if (!rowsResult.success && !isRowFetchCancelled(rowsResult.error)) {
      toast.error(rowsResult.error ?? rowsResult.message);
    }
  };

  const loadPage = async (page: number) => {
    if (!selectedDatabase || !selectedTable) return;
    const result = await fetchTableRows(selectedDatabase, selectedTable, page, rowsLimit);
    if (!result.success && !isRowFetchCancelled(result.error)) {
      toast.error(result.error ?? result.message);
    }
  };

  const handleLimitChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!selectedDatabase || !selectedTable) return;
    const nextLimit = Number(event.target.value);
    if (!Number.isFinite(nextLimit) || nextLimit < 1) return;
    const result = await fetchTableRows(selectedDatabase, selectedTable, 1, nextLimit);
    if (!result.success && !isRowFetchCancelled(result.error)) {
      toast.error(result.error ?? result.message);
    }
  };

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

  const handleExportTableCsv = async () => {
    if (!selectedDatabase || !selectedTable) return;

    const result = await exportTableCsv(selectedDatabase, selectedTable);
    if (result.success) {
      toast.success(result.filePath ? `${result.message} (${result.filePath})` : result.message);
      return;
    }

    if (isUserCancelled(result.error)) return;
    toast.error(result.error ?? result.message);
  };

  const pushSqlToHistory = (sql: string) => {
    const normalized = sql.trim();
    if (!normalized) return;

    setSqlHistory((current) => {
      const deduped = [normalized, ...current.filter((item) => item !== normalized)];
      return deduped.slice(0, SQL_HISTORY_MAX_ITEMS);
    });
    setSelectedHistorySql('');
  };

  const executeSqlConsoleQuery = async (
    databaseName: string,
    sql: string,
    allowWrite: boolean
  ): Promise<void> => {
    pushSqlToHistory(sql);
    const result = await executeSqlQuery(databaseName, sql, allowWrite);
    if (!result.success) {
      toast.error(result.error ?? result.message);
      return;
    }

    toast.success(result.message);
  };

  const runSqlQuery = async () => {
    const databaseName = sqlDatabase.trim();
    const sql = sqlInput.trim();
    if (!databaseName) {
      toast.error('Select a database for SQL Console');
      return;
    }

    if (!sql) {
      toast.error('SQL query is required');
      return;
    }

    const keyword = getSqlKeyword(sql);
    if (SQL_DANGEROUS_WRITE_KEYWORDS.has(keyword)) {
      setPendingWriteQuery({
        databaseName,
        sql,
        keyword: keyword as 'UPDATE' | 'DELETE',
      });
      return;
    }

    if (SQL_WRITE_KEYWORDS.has(keyword)) {
      const confirmed = window.confirm(`Run ${keyword} query on "${databaseName}"?`);
      if (!confirmed) return;
      await executeSqlConsoleQuery(databaseName, sql, true);
      return;
    }

    await executeSqlConsoleQuery(databaseName, sql, false);
  };

  const confirmPendingWriteQuery = async () => {
    if (!pendingWriteQuery) return;
    const { databaseName, sql } = pendingWriteQuery;
    setPendingWriteQuery(null);
    await executeSqlConsoleQuery(databaseName, sql, true);
  };

  const selectedTableExportKey =
    selectedDatabase && selectedTable ? `${selectedDatabase}.${selectedTable}` : null;
  const exportingSelectedTableCsv =
    selectedTableExportKey !== null && exportingTableCsv === selectedTableExportKey;

  const handleSqlInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!runningQuery) {
        void runSqlQuery();
      }
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
            Manage local MySQL databases, browse tables, and run safe SQL console queries.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-2 rounded-xl border border-border-color bg-bg-card p-5 space-y-6">
          <div>
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

          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-text-primary">Databases</h2>
                <span className="text-xs text-text-muted">{databases.length}</span>
              </div>
              <button
                onClick={() => void refreshDatabases()}
                disabled={loadingDatabases}
                className="flex items-center gap-1.5 rounded-md border border-border-color px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
                title="Refresh databases"
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
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
                <Loader2 size={20} className="animate-spin text-accent-blue" />
                Loading databases...
              </div>
            ) : databases.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-color p-6 text-center">
                <p className="text-sm text-text-muted">No databases found.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {databases.map((databaseName) => {
                  const system = isSystemDatabase(databaseName);
                  const isSelected = selectedDatabase === databaseName;
                  const isDeleting = deletingDatabase === databaseName;
                  const isImporting = importingDatabase === databaseName;
                  const isExporting = exportingDatabase === databaseName;
                  const disableActions = isDeleting || isImporting || isExporting;

                  return (
                    <div
                      key={databaseName}
                      className={cn(
                        'rounded-lg border p-3 transition-all',
                        isSelected
                          ? 'border-accent-blue/40 bg-accent-blue/10'
                          : 'border-border-color bg-bg-secondary/50 hover:bg-white/5'
                      )}
                    >
                      <button
                        onClick={() => void handleSelectDatabase(databaseName)}
                        className="w-full text-left"
                      >
                        <p className="text-sm font-semibold text-text-primary break-all">{databaseName}</p>
                        {system && (
                          <div className="mt-1 inline-flex items-center gap-1 rounded border border-accent-orange/30 bg-accent-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-orange">
                            <Shield size={10} />
                            System
                          </div>
                        )}
                      </button>

                      <div className="mt-2 flex items-center gap-1">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleImportDatabase(databaseName);
                          }}
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
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleExportDatabase(databaseName);
                          }}
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
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteDatabase(databaseName);
                          }}
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
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-text-primary">Tables</h2>
                <span className="text-xs text-text-muted">{selectedDatabase ?? 'None selected'}</span>
              </div>
              <button
                onClick={() => void refreshTables()}
                disabled={!selectedDatabase || loadingTables}
                className="flex items-center gap-1.5 rounded-md border border-border-color px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
                title="Refresh tables"
              >
                {loadingTables ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                Refresh
              </button>
            </div>

            {!selectedDatabase ? (
              <div className="rounded-lg border border-dashed border-border-color p-6 text-center">
                <p className="text-sm text-text-muted">Select a database to load tables.</p>
              </div>
            ) : loadingTables ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-muted">
                <Loader2 size={18} className="animate-spin text-accent-blue" />
                Loading tables...
              </div>
            ) : tables.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-color p-6 text-center">
                <p className="text-sm text-text-muted">No tables found in this database.</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
                {tables.map((tableName) => {
                  const isSelected = selectedTable === tableName;
                  return (
                    <button
                      key={tableName}
                      onClick={() => void handleSelectTable(tableName)}
                      className={cn(
                        'w-full flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-all',
                        isSelected
                          ? 'border-accent-blue/40 bg-accent-blue/10 text-text-primary'
                          : 'border-border-color bg-bg-secondary/40 text-text-secondary hover:text-text-primary hover:bg-white/5'
                      )}
                    >
                      <Table2 size={14} />
                      <span className="break-all">{tableName}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="xl:col-span-3 rounded-xl border border-border-color bg-bg-card p-5 space-y-5">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.03] border border-border-color w-fit">
            <button
              onClick={() => setActiveTab('browser')}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-all',
                activeTab === 'browser'
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : 'text-text-muted hover:text-text-primary hover:bg-white/5'
              )}
            >
              Browser
            </button>
            <button
              onClick={() => setActiveTab('sql')}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-all',
                activeTab === 'sql'
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : 'text-text-muted hover:text-text-primary hover:bg-white/5'
              )}
            >
              SQL Console
            </button>
          </div>

          {activeTab === 'browser' ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">Table Browser</h2>
                  <p className="text-xs text-text-muted mt-0.5">
                    {selectedDatabase && selectedTable
                      ? `${selectedDatabase}.${selectedTable}`
                      : 'Select a database and table to inspect schema and data'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleExportTableCsv()}
                    disabled={
                      !selectedDatabase ||
                      !selectedTable ||
                      loadingSchema ||
                      loadingRows ||
                      exportingSelectedTableCsv
                    }
                    className="flex items-center gap-1.5 rounded-md border border-border-color px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
                    title="Export selected table to CSV"
                  >
                    {exportingSelectedTableCsv ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Download size={13} />
                    )}
                    Export CSV
                  </button>
                  <button
                    onClick={() => void refreshSelectedTable()}
                    disabled={!selectedDatabase || !selectedTable || loadingSchema || loadingRows}
                    className="flex items-center gap-1.5 rounded-md border border-border-color px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
                    title="Refresh selected table"
                  >
                    {loadingSchema || loadingRows ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    Refresh
                  </button>
                </div>
              </div>

              {browserError && (
                <div className="flex items-center gap-2 rounded-lg border border-status-stopped/35 bg-status-stopped/10 px-3 py-2 text-xs text-status-stopped">
                  <AlertTriangle size={14} />
                  {browserError}
                </div>
              )}

              {!selectedDatabase ? (
                <div className="rounded-lg border border-dashed border-border-color p-10 text-center">
                  <p className="text-sm text-text-muted">Select a database to start browsing.</p>
                </div>
              ) : !selectedTable ? (
                <div className="rounded-lg border border-dashed border-border-color p-10 text-center">
                  <p className="text-sm text-text-muted">
                    {tables.length === 0
                      ? 'This database has no tables.'
                      : 'Select a table from the left panel to view schema and rows.'}
                  </p>
                </div>
              ) : (
                <>
                  <section className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Schema ({schemaColumns.length} columns)
                      </h3>
                      {loadingSchema && <Loader2 size={14} className="animate-spin text-accent-blue" />}
                    </div>

                    {schemaColumns.length === 0 && !loadingSchema ? (
                      <div className="rounded-lg border border-dashed border-border-color p-5 text-center">
                        <p className="text-sm text-text-muted">No schema data available.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-border-color">
                        <table className="min-w-full text-xs">
                          <thead className="bg-bg-secondary/70 text-text-muted">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold">Field</th>
                              <th className="px-3 py-2 text-left font-semibold">Type</th>
                              <th className="px-3 py-2 text-left font-semibold">Null</th>
                              <th className="px-3 py-2 text-left font-semibold">Key</th>
                              <th className="px-3 py-2 text-left font-semibold">Default</th>
                              <th className="px-3 py-2 text-left font-semibold">Extra</th>
                            </tr>
                          </thead>
                          <tbody>
                            {schemaColumns.map((column) => (
                              <tr key={column.field} className="border-t border-border-color">
                                <td className="px-3 py-2 font-mono text-text-primary">{column.field}</td>
                                <td className="px-3 py-2 font-mono text-text-secondary">{column.type}</td>
                                <td className="px-3 py-2 text-text-secondary">
                                  {column.nullable ? 'YES' : 'NO'}
                                </td>
                                <td className="px-3 py-2 text-text-secondary">{column.key || '-'}</td>
                                <td className="px-3 py-2 text-text-secondary">
                                  {column.defaultValue === null ? 'NULL' : column.defaultValue || '-'}
                                </td>
                                <td className="px-3 py-2 text-text-secondary">{column.extra || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Rows ({rows.length} on page {rowsPage})
                      </h3>

                      <div className="flex items-center gap-2">
                        <label htmlFor="rows-limit" className="text-xs text-text-muted">
                          Rows per page
                        </label>
                        <select
                          id="rows-limit"
                          value={rowsLimit}
                          onChange={(event) => void handleLimitChange(event)}
                          disabled={loadingRows}
                          className="rounded-md border border-border-color bg-bg-secondary px-2.5 py-1.5 text-xs text-text-primary outline-none"
                        >
                          {ROWS_LIMIT_OPTIONS.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {loadingRows ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 size={22} className="animate-spin text-accent-blue" />
                        <span className="ml-3 text-sm text-text-muted">Loading rows...</span>
                      </div>
                    ) : rowColumns.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border-color p-6 text-center">
                        <p className="text-sm text-text-muted">No row data available.</p>
                      </div>
                    ) : (
                      <div className="overflow-auto rounded-lg border border-border-color max-h-[420px]">
                        <table className="min-w-full text-xs">
                          <thead className="bg-bg-secondary/70 text-text-muted sticky top-0 z-10">
                            <tr>
                              {rowColumns.map((column) => (
                                <th key={column} className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                                  {column}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={rowColumns.length}
                                  className="px-3 py-6 text-center text-sm text-text-muted"
                                >
                                  No rows found on this page.
                                </td>
                              </tr>
                            ) : (
                              rows.map((row, index) => (
                                <tr key={`${rowsPage}-${index}`} className="border-t border-border-color">
                                  {rowColumns.map((column) => {
                                    const value = row[column];
                                    return (
                                      <td
                                        key={`${rowsPage}-${index}-${column}`}
                                        className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap"
                                      >
                                        {value === null ? (
                                          <span className="text-accent-orange">NULL</span>
                                        ) : (
                                          value
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => void loadPage(rowsPage - 1)}
                        disabled={loadingRows || rowsPage <= 1}
                        className="rounded-md border border-border-color px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span className="text-xs text-text-muted">
                        Page {rowsPage}
                      </span>
                      <button
                        onClick={() => void loadPage(rowsPage + 1)}
                        disabled={loadingRows || !rowsHasMore}
                        className="rounded-md border border-border-color px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </section>
                </>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <TerminalSquare size={18} className="text-accent-blue" />
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">SQL Console</h2>
                  <p className="text-xs text-text-muted">
                    Allowed read queries: SELECT, SHOW, DESCRIBE, EXPLAIN. Press Ctrl+Enter to run.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                <div className="lg:col-span-2">
                  <label
                    htmlFor="sql-console-db"
                    className="text-xs font-semibold uppercase tracking-wider text-text-muted"
                  >
                    Database
                  </label>
                  <select
                    id="sql-console-db"
                    value={sqlDatabase}
                    onChange={(event) => setSqlDatabase(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                    disabled={databases.length === 0 || runningQuery}
                  >
                    {databases.length === 0 ? (
                      <option value="">No databases available</option>
                    ) : (
                      databases.map((databaseName) => (
                        <option key={databaseName} value={databaseName}>
                          {databaseName}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="lg:col-span-3 flex items-end justify-end gap-2">
                  <button
                    onClick={clearSqlQueryState}
                    disabled={runningQuery && !queryResult && !queryError}
                    className="rounded-md border border-border-color px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-50"
                  >
                    Clear Result
                  </button>
                  <button
                    onClick={() => void runSqlQuery()}
                    disabled={runningQuery || databases.length === 0}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-all',
                      'bg-accent-blue/15 text-accent-blue border-accent-blue/30 hover:bg-accent-blue/25',
                      'disabled:opacity-60 disabled:cursor-not-allowed'
                    )}
                  >
                    {runningQuery ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Play size={14} />
                        Run Query
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                <div className="lg:col-span-3">
                  <label
                    htmlFor="sql-console-history"
                    className="text-xs font-semibold uppercase tracking-wider text-text-muted"
                  >
                    Session History
                  </label>
                  <div className="mt-1 relative">
                    <History
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                    />
                    <select
                      id="sql-console-history"
                      value={selectedHistorySql}
                      onChange={(event) => {
                        const selectedSql = event.target.value;
                        setSelectedHistorySql(selectedSql);
                        if (selectedSql) {
                          setSqlInput(selectedSql);
                        }
                      }}
                      disabled={runningQuery || sqlHistory.length === 0}
                      className="w-full rounded-lg border border-border-color bg-bg-secondary pl-8 pr-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50 disabled:opacity-60"
                    >
                      <option value="">
                        {sqlHistory.length === 0 ? 'No query history in this session' : 'Select a previous query'}
                      </option>
                      {sqlHistory.map((entry, index) => (
                        <option key={`history-${index}`} value={entry}>
                          {`${index + 1}. ${getHistoryLabel(entry)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="lg:col-span-2 flex items-end">
                  <div className="w-full rounded-lg border border-border-color bg-bg-secondary/40 px-3 py-2 text-xs text-text-muted">
                    Shortcut: <span className="text-text-primary font-semibold">Ctrl+Enter</span>
                  </div>
                </div>
              </div>

              <div>
                <label
                  htmlFor="sql-console-input"
                  className="text-xs font-semibold uppercase tracking-wider text-text-muted"
                >
                  SQL Editor
                </label>
                <textarea
                  id="sql-console-input"
                  value={sqlInput}
                  onChange={(event) => setSqlInput(event.target.value)}
                  onKeyDown={handleSqlInputKeyDown}
                  className="mt-1 w-full min-h-[180px] rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm font-mono text-text-primary outline-none transition-all focus:border-accent-blue/50 resize-y"
                  placeholder="SELECT * FROM users LIMIT 100"
                  spellCheck={false}
                />
                <p className="mt-1 text-xs text-text-muted">
                  UPDATE and DELETE require a warning confirmation before execution.
                </p>
              </div>

              {queryError && (
                <div className="flex items-center gap-2 rounded-lg border border-status-stopped/35 bg-status-stopped/10 px-3 py-2 text-xs text-status-stopped">
                  <AlertTriangle size={14} />
                  {queryError}
                </div>
              )}

              {runningQuery && (
                <div className="flex items-center gap-2 rounded-lg border border-accent-blue/30 bg-accent-blue/10 px-3 py-2 text-xs text-accent-blue">
                  <Loader2 size={14} className="animate-spin" />
                  Executing query...
                </div>
              )}

              {!queryResult ? (
                !queryError && (
                  <div className="rounded-lg border border-dashed border-border-color p-8 text-center">
                    <p className="text-sm text-text-muted">Run a query to view results.</p>
                  </div>
                )
              ) : (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded border border-accent-blue/30 bg-accent-blue/15 text-accent-blue font-semibold uppercase tracking-wider">
                      {queryResult.queryType}
                    </span>
                    {queryResult.affectedRows === null ? (
                      <span className="text-text-muted">
                        Rows: <span className="text-text-primary">{queryResult.rowCount}</span>
                      </span>
                    ) : (
                      <span className="text-text-muted">Write query completed</span>
                    )}
                    {queryResult.truncated && (
                      <span className="text-accent-orange">
                        Result was truncated to 500 rows.
                      </span>
                    )}
                  </div>

                  {queryResult.affectedRows !== null && (
                    <div
                      className={cn(
                        'rounded-lg border px-3 py-2',
                        queryResult.affectedRows > 0
                          ? 'border-status-running/35 bg-status-running/10'
                          : 'border-accent-orange/35 bg-accent-orange/10'
                      )}
                    >
                      <p className="text-sm font-semibold text-text-primary">
                        {queryResult.queryType.toUpperCase()} query executed.
                      </p>
                      <p className="text-xs text-text-muted mt-0.5">
                        <span className="font-semibold text-text-primary">{queryResult.affectedRows}</span> rows
                        affected.
                      </p>
                    </div>
                  )}

                  {queryResult.columns.length > 0 ? (
                    <div className="overflow-auto rounded-lg border border-border-color max-h-[420px]">
                      <table className="min-w-full text-xs">
                        <thead className="bg-bg-secondary/70 text-text-muted sticky top-0 z-10">
                          <tr>
                            {queryResult.columns.map((column) => (
                              <th key={column} className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {queryResult.rows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={queryResult.columns.length}
                                className="px-3 py-6 text-center text-sm text-text-muted"
                              >
                                Query returned no rows.
                              </td>
                            </tr>
                          ) : (
                            queryResult.rows.map((row, index) => (
                              <tr key={`query-row-${index}`} className="border-t border-border-color">
                                {queryResult.columns.map((column) => {
                                  const value = row[column];
                                  return (
                                    <td
                                      key={`query-row-${index}-${column}`}
                                      className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap"
                                    >
                                      {value === null ? (
                                        <span className="text-accent-orange">NULL</span>
                                      ) : (
                                        value
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border-color p-6 text-center">
                      <p className="text-sm text-text-muted">{queryResult.message}</p>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {pendingWriteQuery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-status-stopped/35 bg-bg-card shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-border-color px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="mt-0.5 text-status-stopped" />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    Confirm {pendingWriteQuery.keyword} Query
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    This action will modify data in <span className="font-semibold">{pendingWriteQuery.databaseName}</span>.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPendingWriteQuery(null)}
                className="rounded-md border border-border-color p-1.5 text-text-muted hover:text-text-primary hover:bg-white/5 transition-all"
                aria-label="Close warning modal"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <div className="rounded-lg border border-status-stopped/30 bg-status-stopped/10 px-3 py-2 text-xs text-status-stopped">
                Review the SQL statement carefully before continuing.
              </div>
              <pre className="max-h-[220px] overflow-auto rounded-lg border border-border-color bg-bg-secondary p-3 text-xs text-text-secondary">
                {pendingWriteQuery.sql}
              </pre>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setPendingWriteQuery(null)}
                  disabled={runningQuery}
                  className="rounded-md border border-border-color px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void confirmPendingWriteQuery()}
                  disabled={runningQuery}
                  className="flex items-center gap-1.5 rounded-md border border-status-stopped/35 bg-status-stopped/10 px-3 py-2 text-xs font-semibold text-status-stopped hover:bg-status-stopped/20 transition-all disabled:opacity-60"
                >
                  {runningQuery ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />}
                  Run {pendingWriteQuery.keyword}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
