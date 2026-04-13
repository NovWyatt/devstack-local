import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  FileText,
  Folder,
  Loader2,
  Lock,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Shield,
  TestTube2,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useRemoteStore } from '../../stores/useRemoteStore';
import type {
  RemoteConnectionInput,
  RemoteConnectionSummary,
  RemoteConnectionTestResult,
  RemoteDirectoryEntry,
  RemoteProtocol,
} from '../../types/remote.types';

interface RemoteFormState {
  name: string;
  protocol: RemoteProtocol;
  host: string;
  port: string;
  username: string;
  password: string;
  rootPath: string;
}

const DEFAULT_PROTOCOL: RemoteProtocol = 'sftp';

function getDefaultPort(protocol: RemoteProtocol): string {
  return protocol === 'sftp' ? '22' : '21';
}

function createInitialForm(protocol: RemoteProtocol = DEFAULT_PROTOCOL): RemoteFormState {
  return {
    name: '',
    protocol,
    host: '',
    port: getDefaultPort(protocol),
    username: '',
    password: '',
    rootPath: protocol === 'sftp' ? '.' : '/',
  };
}

function toEditForm(connection: RemoteConnectionSummary): RemoteFormState {
  return {
    name: connection.name,
    protocol: connection.protocol,
    host: connection.host,
    port: String(connection.port),
    username: connection.username,
    password: '',
    rootPath: connection.rootPath,
  };
}

function buildPayload(form: RemoteFormState): RemoteConnectionInput | null {
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return {
    name: form.name,
    protocol: form.protocol,
    host: form.host,
    port,
    username: form.username,
    password: form.password,
    rootPath: form.rootPath,
  };
}

function formatSize(size: number | null): string {
  if (size === null || size < 0) return 'n/a';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getEntryIcon(entry: RemoteDirectoryEntry) {
  return entry.type === 'directory' ? <Folder size={14} /> : <FileText size={14} />;
}

function getStatusClasses(status: RemoteConnectionSummary['status']): string {
  if (status === 'connected') {
    return 'border-status-running/30 bg-status-running/10 text-status-running';
  }
  if (status === 'error') {
    return 'border-status-stopped/30 bg-status-stopped/10 text-status-stopped';
  }
  return 'border-border-color bg-bg-secondary text-text-muted';
}

export function RemoteManager() {
  const connections = useRemoteStore((state) => state.connections);
  const selectedConnectionId = useRemoteStore((state) => state.selectedConnectionId);
  const previewConnectionId = useRemoteStore((state) => state.previewConnectionId);
  const previewRootPath = useRemoteStore((state) => state.previewRootPath);
  const previewEntries = useRemoteStore((state) => state.previewEntries);
  const loadingConnections = useRemoteStore((state) => state.loadingConnections);
  const submittingConnection = useRemoteStore((state) => state.submittingConnection);
  const deletingConnectionId = useRemoteStore((state) => state.deletingConnectionId);
  const testingConnection = useRemoteStore((state) => state.testingConnection);
  const connectingConnectionId = useRemoteStore((state) => state.connectingConnectionId);
  const disconnectingConnectionId = useRemoteStore((state) => state.disconnectingConnectionId);
  const loadingPreviewConnectionId = useRemoteStore((state) => state.loadingPreviewConnectionId);
  const pageError = useRemoteStore((state) => state.pageError);
  const fetchConnections = useRemoteStore((state) => state.fetchConnections);
  const selectConnection = useRemoteStore((state) => state.selectConnection);
  const createConnection = useRemoteStore((state) => state.createConnection);
  const updateConnection = useRemoteStore((state) => state.updateConnection);
  const deleteConnection = useRemoteStore((state) => state.deleteConnection);
  const testConnection = useRemoteStore((state) => state.testConnection);
  const connectConnection = useRemoteStore((state) => state.connectConnection);
  const disconnectConnection = useRemoteStore((state) => state.disconnectConnection);
  const loadPreview = useRemoteStore((state) => state.loadPreview);
  const clearPreview = useRemoteStore((state) => state.clearPreview);

  const hasInitialized = useRef(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<RemoteConnectionSummary | null>(null);
  const [form, setForm] = useState<RemoteFormState>(createInitialForm());
  const [testResult, setTestResult] = useState<RemoteConnectionTestResult | null>(null);

  const selectedConnection = useMemo(
    () => connections.find((item) => item.id === selectedConnectionId) ?? null,
    [connections, selectedConnectionId]
  );

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    void fetchConnections();
  }, [fetchConnections]);

  useEffect(() => {
    if (!selectedConnection) return;
    if (selectedConnection.status !== 'connected') return;
    if (previewConnectionId === selectedConnection.id) return;
    if (loadingPreviewConnectionId === selectedConnection.id) return;
    void loadPreview(selectedConnection.id);
  }, [selectedConnection, previewConnectionId, loadingPreviewConnectionId, loadPreview]);

  const openCreateModal = () => {
    setEditingConnection(null);
    setForm(createInitialForm());
    setTestResult(null);
    setIsModalOpen(true);
  };

  const openEditModal = (connection: RemoteConnectionSummary) => {
    setEditingConnection(connection);
    setForm(toEditForm(connection));
    setTestResult(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingConnection(null);
    setForm(createInitialForm());
    setTestResult(null);
  };

  const handleFormChange = (key: keyof RemoteFormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleProtocolChange = (protocol: RemoteProtocol) => {
    setForm((current) => ({
      ...current,
      protocol,
      port: getDefaultPort(protocol),
      rootPath: protocol === 'sftp' ? '.' : '/',
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = buildPayload(form);
    if (!payload) {
      toast.error('Port must be between 1 and 65535');
      return;
    }

    const result = editingConnection
      ? await updateConnection(editingConnection.id, payload)
      : await createConnection(payload);
    if (result.success) {
      toast.success(result.message);
      closeModal();
      return;
    }
    toast.error(result.error ?? result.message);
  };

  const handleTestConnection = async () => {
    const payload = buildPayload(form);
    if (!payload) {
      toast.error('Port must be between 1 and 65535');
      return;
    }

    const result = await testConnection(payload, editingConnection?.id);
    setTestResult(result);
    result.success ? toast.success(result.message) : toast.error(result.error ?? result.message);
  };

  const handleDelete = async (connection: RemoteConnectionSummary) => {
    if (!window.confirm(`Delete connection "${connection.name}"?`)) return;
    const result = await deleteConnection(connection.id);
    if (result.success) {
      toast.success(result.message);
      if (selectedConnectionId === connection.id) {
        clearPreview();
      }
      return;
    }
    toast.error(result.error ?? result.message);
  };

  const handleConnect = async (connectionId: string) => {
    const result = await connectConnection(connectionId);
    result.success ? toast.success(result.message) : toast.error(result.error ?? result.message);
  };

  const handleDisconnect = async (connectionId: string) => {
    const result = await disconnectConnection(connectionId);
    if (result.success) {
      toast.success(result.error ? `${result.message}: ${result.error}` : result.message);
      return;
    }
    toast.error(result.error ?? result.message);
  };

  const handleRefreshPreview = async () => {
    if (!selectedConnection) return;
    const result = await loadPreview(selectedConnection.id);
    if (!result.success) {
      toast.error(result.error ?? result.message);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent-blue/15">
            <Server size={20} className="text-accent-blue" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">SSH / FTP Manager</h1>
            <p className="text-sm text-text-muted">
              Save remote connections, test them safely, and preview the remote root directory.
            </p>
          </div>
        </div>

        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 rounded-lg border border-accent-blue/30 bg-accent-blue/15 px-4 py-2.5 text-sm font-semibold text-accent-blue hover:bg-accent-blue/25 transition-all"
        >
          <Plus size={15} />
          Add Connection
        </button>
      </div>

      {pageError && (
        <div className="flex items-center gap-2 rounded-lg border border-status-stopped/35 bg-status-stopped/10 px-3 py-2 text-sm text-status-stopped">
          <AlertTriangle size={15} />
          {pageError}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-2 rounded-xl border border-border-color bg-bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Saved Connections</h2>
              <p className="text-xs text-text-muted mt-0.5">{connections.length} total</p>
            </div>
            <button
              onClick={() => void fetchConnections()}
              disabled={loadingConnections}
              className="flex items-center gap-1.5 rounded-md border border-border-color px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
            >
              {loadingConnections ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Refresh
            </button>
          </div>

          {loadingConnections ? (
            <div className="flex items-center justify-center py-14">
              <Loader2 size={22} className="animate-spin text-accent-blue" />
              <span className="ml-3 text-sm text-text-muted">Loading connections...</span>
            </div>
          ) : connections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-color p-8 text-center">
              <p className="text-sm text-text-muted">No remote connections saved yet.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
              {connections.map((connection) => {
                const isSelected = selectedConnectionId === connection.id;
                const isConnecting = connectingConnectionId === connection.id;
                const isDisconnecting = disconnectingConnectionId === connection.id;
                const isDeleting = deletingConnectionId === connection.id;
                const busy = isConnecting || isDisconnecting || isDeleting;

                return (
                  <div
                    key={connection.id}
                    className={cn(
                      'rounded-lg border p-3 transition-all',
                      isSelected
                        ? 'border-accent-blue/40 bg-accent-blue/10'
                        : 'border-border-color bg-bg-secondary/50 hover:bg-white/5'
                    )}
                  >
                    <button onClick={() => selectConnection(connection.id)} className="w-full text-left">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text-primary break-all">
                            {connection.name}
                          </p>
                          <p className="mt-1 text-xs font-mono text-text-muted break-all">
                            {connection.username}@{connection.host}:{connection.port}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                            getStatusClasses(connection.status)
                          )}
                        >
                          {connection.status}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
                        <span className="rounded border border-accent-blue/30 bg-accent-blue/15 px-2 py-0.5 text-accent-blue">
                          {connection.protocol}
                        </span>
                        <span className="rounded border border-border-color px-2 py-0.5 text-text-muted">
                          Root {connection.rootPath}
                        </span>
                        {connection.protocol === 'sftp' ? (
                          <span className="rounded border border-status-running/30 bg-status-running/10 px-2 py-0.5 text-status-running">
                            Secure
                          </span>
                        ) : (
                          <span className="rounded border border-accent-orange/30 bg-accent-orange/10 px-2 py-0.5 text-accent-orange">
                            Legacy FTP
                          </span>
                        )}
                      </div>
                    </button>

                    {connection.lastError && (
                      <div className="mt-2 rounded-md border border-status-stopped/25 bg-status-stopped/10 px-2.5 py-2 text-xs text-status-stopped">
                        {connection.lastError}
                      </div>
                    )}

                    <div className="mt-3 flex items-center gap-1">
                      {connection.status === 'connected' ? (
                        <button
                          onClick={() => void handleDisconnect(connection.id)}
                          disabled={busy}
                          className="flex items-center justify-center w-8 h-8 rounded-md text-accent-orange hover:text-accent-orange hover:bg-accent-orange/10 transition-all disabled:opacity-60"
                          title="Disconnect"
                        >
                          {isDisconnecting ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
                        </button>
                      ) : (
                        <button
                          onClick={() => void handleConnect(connection.id)}
                          disabled={busy}
                          className="flex items-center justify-center w-8 h-8 rounded-md text-status-running hover:text-status-running hover:bg-status-running/10 transition-all disabled:opacity-60"
                          title="Connect"
                        >
                          {isConnecting ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                        </button>
                      )}

                      <button
                        onClick={() => openEditModal(connection)}
                        disabled={busy}
                        className="flex items-center justify-center w-8 h-8 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>

                      <button
                        onClick={() => void handleDelete(connection)}
                        disabled={busy}
                        className="flex items-center justify-center w-8 h-8 rounded-md text-status-stopped/80 hover:text-status-stopped hover:bg-status-stopped/10 transition-all disabled:opacity-60"
                        title="Delete"
                      >
                        {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="xl:col-span-3 rounded-xl border border-border-color bg-bg-card p-5 space-y-4">
          {!selectedConnection ? (
            <div className="rounded-lg border border-dashed border-border-color p-10 text-center">
              <p className="text-sm text-text-muted">Select a saved connection to view details.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-text-primary">
                      {selectedConnection.name}
                    </h2>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        getStatusClasses(selectedConnection.status)
                      )}
                    >
                      {selectedConnection.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-mono text-text-muted break-all">
                    {selectedConnection.username}@{selectedConnection.host}:{selectedConnection.port}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
                    <span className="rounded border border-accent-blue/30 bg-accent-blue/15 px-2 py-0.5 text-accent-blue">
                      {selectedConnection.protocol}
                    </span>
                    <span className="rounded border border-border-color px-2 py-0.5 text-text-muted">
                      Root {selectedConnection.rootPath}
                    </span>
                    <span className="rounded border border-status-running/30 bg-status-running/10 px-2 py-0.5 text-status-running">
                      Password Stored
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedConnection.status === 'connected' ? (
                    <>
                      <button
                        onClick={() => void handleRefreshPreview()}
                        disabled={loadingPreviewConnectionId === selectedConnection.id}
                        className="flex items-center gap-2 rounded-lg border border-border-color px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
                      >
                        {loadingPreviewConnectionId === selectedConnection.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                        Refresh Root
                      </button>
                      <button
                        onClick={() => void handleDisconnect(selectedConnection.id)}
                        disabled={disconnectingConnectionId === selectedConnection.id}
                        className="flex items-center gap-2 rounded-lg border border-accent-orange/30 bg-accent-orange/10 px-3 py-2 text-sm font-semibold text-accent-orange hover:bg-accent-orange/20 transition-all disabled:opacity-60"
                      >
                        {disconnectingConnectionId === selectedConnection.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Unplug size={14} />
                        )}
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => void handleConnect(selectedConnection.id)}
                      disabled={connectingConnectionId === selectedConnection.id}
                      className="flex items-center gap-2 rounded-lg border border-status-running/30 bg-status-running/10 px-3 py-2 text-sm font-semibold text-status-running hover:bg-status-running/20 transition-all disabled:opacity-60"
                    >
                      {connectingConnectionId === selectedConnection.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Plug size={14} />
                      )}
                      Connect
                    </button>
                  )}
                </div>
              </div>

              {selectedConnection.protocol === 'ftp' && (
                <div className="flex items-center gap-2 rounded-lg border border-accent-orange/35 bg-accent-orange/10 px-3 py-2 text-sm text-accent-orange">
                  <Shield size={15} />
                  FTP is legacy and not encrypted. Prefer SFTP when possible.
                </div>
              )}

              <div className="rounded-lg border border-border-color bg-bg-secondary/40">
                <div className="flex items-center justify-between gap-3 border-b border-border-color px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">Remote Root Preview</h3>
                    <p className="text-xs text-text-muted mt-0.5">
                      {previewConnectionId === selectedConnection.id && previewRootPath
                        ? previewRootPath
                        : selectedConnection.rootPath}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Lock size={13} />
                    No shell access
                  </div>
                </div>

                {selectedConnection.status !== 'connected' ? (
                  <div className="p-8 text-center">
                    <p className="text-sm text-text-muted">
                      Connect this entry to preview the remote root directory.
                    </p>
                  </div>
                ) : loadingPreviewConnectionId === selectedConnection.id &&
                  previewConnectionId !== selectedConnection.id ? (
                  <div className="flex items-center justify-center py-14">
                    <Loader2 size={22} className="animate-spin text-accent-blue" />
                    <span className="ml-3 text-sm text-text-muted">Loading remote root...</span>
                  </div>
                ) : previewConnectionId !== selectedConnection.id ? (
                  <div className="p-8 text-center">
                    <p className="text-sm text-text-muted">
                      Preview not loaded yet. Refresh the root listing.
                    </p>
                  </div>
                ) : previewEntries.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-sm text-text-muted">Root directory is empty or inaccessible.</p>
                  </div>
                ) : (
                  <div className="max-h-[460px] overflow-y-auto">
                    <div className="grid grid-cols-[minmax(0,1.4fr)_120px_120px] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      <span>Name</span>
                      <span>Type</span>
                      <span>Size</span>
                    </div>
                    <div className="divide-y divide-border-color">
                      {previewEntries.map((entry) => (
                        <div
                          key={entry.path}
                          className="grid grid-cols-[minmax(0,1.4fr)_120px_120px] gap-3 px-4 py-3 text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-text-muted">{getEntryIcon(entry)}</span>
                            <span className="truncate text-text-primary">{entry.name}</span>
                          </div>
                          <span className="text-text-secondary capitalize">{entry.type}</span>
                          <span className="text-text-secondary">{formatSize(entry.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-border-color bg-bg-card shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-border-color px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  {editingConnection ? 'Edit Connection' : 'Add Connection'}
                </h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Save a password-based SFTP or FTP connection and test it before connecting.
                </p>
              </div>
              <button
                onClick={closeModal}
                className="rounded-md border border-border-color p-1.5 text-text-muted hover:text-text-primary hover:bg-white/5 transition-all"
                aria-label="Close connection modal"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4 px-4 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="remote-name" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Connection Name
                  </label>
                  <input
                    id="remote-name"
                    value={form.name}
                    onChange={(event) => handleFormChange('name', event.target.value)}
                    placeholder="Production SFTP"
                    className="w-full rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="remote-protocol" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Protocol
                  </label>
                  <select
                    id="remote-protocol"
                    value={form.protocol}
                    onChange={(event) => handleProtocolChange(event.target.value as RemoteProtocol)}
                    className="w-full rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                  >
                    <option value="sftp">SFTP</option>
                    <option value="ftp">FTP</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="remote-host" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Host
                  </label>
                  <input
                    id="remote-host"
                    value={form.host}
                    onChange={(event) => handleFormChange('host', event.target.value)}
                    placeholder="example.com"
                    className="w-full rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="remote-port" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Port
                  </label>
                  <input
                    id="remote-port"
                    value={form.port}
                    onChange={(event) => handleFormChange('port', event.target.value)}
                    inputMode="numeric"
                    className="w-full rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="remote-username" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Username
                  </label>
                  <input
                    id="remote-username"
                    value={form.username}
                    onChange={(event) => handleFormChange('username', event.target.value)}
                    placeholder="deploy"
                    className="w-full rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="remote-password" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Password
                  </label>
                  <input
                    id="remote-password"
                    type="password"
                    value={form.password}
                    onChange={(event) => handleFormChange('password', event.target.value)}
                    placeholder={editingConnection ? 'Leave blank to keep saved password' : 'Password'}
                    className="w-full rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                    required={!editingConnection}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="remote-root-path" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Root Path
                </label>
                <input
                  id="remote-root-path"
                  value={form.rootPath}
                  onChange={(event) => handleFormChange('rootPath', event.target.value)}
                  placeholder={form.protocol === 'sftp' ? '.' : '/'}
                  className="w-full rounded-lg border border-border-color bg-bg-secondary px-3 py-2.5 text-sm text-text-primary outline-none transition-all focus:border-accent-blue/50"
                />
                <p className="text-xs text-text-muted">
                  Saved passwords stay isolated from connection metadata and use OS-backed encryption in Electron.
                </p>
              </div>

              {form.protocol === 'ftp' && (
                <div className="flex items-center gap-2 rounded-lg border border-accent-orange/35 bg-accent-orange/10 px-3 py-2 text-sm text-accent-orange">
                  <AlertTriangle size={15} />
                  FTP is unencrypted. Use SFTP unless you need legacy server compatibility.
                </div>
              )}

              {testResult && (
                <div
                  className={cn(
                    'rounded-lg border px-3 py-3',
                    testResult.success
                      ? 'border-status-running/35 bg-status-running/10'
                      : 'border-status-stopped/35 bg-status-stopped/10'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {testResult.success ? (
                      <Shield size={16} className="mt-0.5 text-status-running" />
                    ) : (
                      <AlertTriangle size={16} className="mt-0.5 text-status-stopped" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary">{testResult.message}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        Root: {testResult.rootPath} • {testResult.entries.length} entries loaded
                      </p>
                      {testResult.entries.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {testResult.entries.slice(0, 6).map((entry) => (
                            <span
                              key={entry.path}
                              className="rounded border border-border-color bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary"
                            >
                              {entry.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void handleTestConnection()}
                  disabled={testingConnection || submittingConnection}
                  className="flex items-center gap-2 rounded-lg border border-border-color px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
                >
                  {testingConnection ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <TestTube2 size={15} />
                  )}
                  Test Connection
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-lg border border-border-color px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingConnection}
                    className="flex items-center gap-2 rounded-lg border border-accent-blue/30 bg-accent-blue/15 px-4 py-2.5 text-sm font-semibold text-accent-blue hover:bg-accent-blue/25 transition-all disabled:opacity-60"
                  >
                    {submittingConnection ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : editingConnection ? (
                      <Pencil size={15} />
                    ) : (
                      <Plus size={15} />
                    )}
                    {editingConnection ? 'Update Connection' : 'Save Connection'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
