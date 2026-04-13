import { useEffect, useState } from 'react';
import { ActivitySquare, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../stores/useAppStore';
import { usePhpStore } from '../../stores/usePhpStore';
import type { AppDiagnostics, ServiceStatusType } from '../../types';

function formatStatus(status: ServiceStatusType): string {
  if (status === 'running') return 'Running';
  if (status === 'stopped') return 'Stopped';
  if (status === 'starting') return 'Starting';
  return 'Stopping';
}

function statusClass(status: ServiceStatusType): string {
  if (status === 'running') return 'text-status-running';
  if (status === 'stopped') return 'text-status-stopped';
  return 'text-status-warning';
}

export function HealthDiagnosticsPanel() {
  const apache = useAppStore((state) => state.apache);
  const mysql = useAppStore((state) => state.mysql);
  const activePhpVersion = usePhpStore((state) => state.activeVersion);

  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiagnostics = async () => {
    if (!window.electronAPI?.appDiagnostics) {
      setDiagnostics(null);
      setError('Diagnostics are available in Electron mode only.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await window.electronAPI.appDiagnostics();
      setDiagnostics(next);
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apache.status, mysql.status, activePhpVersion]);

  const apacheStatus = diagnostics?.services.apache.status ?? apache.status;
  const mysqlStatus = diagnostics?.services.mysql.status ?? mysql.status;
  const phpRunning = diagnostics?.services.phpCgi.running ?? false;
  const phpPort = diagnostics?.services.phpCgi.port ?? null;
  const phpVersion = diagnostics?.services.phpCgi.activeVersion ?? activePhpVersion;

  return (
    <div className="rounded-xl border border-border-color bg-bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ActivitySquare size={18} className="text-accent-blue" />
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Health Diagnostics</h2>
            <p className="text-xs text-text-muted">Read-only runtime status and writable path snapshot.</p>
          </div>
        </div>
        <button
          onClick={() => void loadDiagnostics()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-border-color px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all disabled:opacity-60"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-status-stopped/35 bg-status-stopped/10 px-3 py-2 text-xs text-status-stopped">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border-color bg-bg-secondary/40 px-3 py-2">
          <p className="text-xs text-text-muted">Apache</p>
          <p className={cn('text-sm font-semibold', statusClass(apacheStatus))}>{formatStatus(apacheStatus)}</p>
          <p className="text-xs font-mono text-text-muted mt-0.5">Port {diagnostics?.services.apache.port ?? apache.port}</p>
        </div>
        <div className="rounded-lg border border-border-color bg-bg-secondary/40 px-3 py-2">
          <p className="text-xs text-text-muted">MySQL</p>
          <p className={cn('text-sm font-semibold', statusClass(mysqlStatus))}>{formatStatus(mysqlStatus)}</p>
          <p className="text-xs font-mono text-text-muted mt-0.5">Port {diagnostics?.services.mysql.port ?? mysql.port}</p>
        </div>
        <div className="rounded-lg border border-border-color bg-bg-secondary/40 px-3 py-2">
          <p className="text-xs text-text-muted">PHP-CGI ({phpVersion})</p>
          <p className={cn('text-sm font-semibold', phpRunning ? 'text-status-running' : 'text-status-stopped')}>
            {phpRunning ? 'Running' : 'Stopped'}
          </p>
          <p className="text-xs font-mono text-text-muted mt-0.5">Port {phpPort ?? '-'}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border-color bg-bg-secondary/30 p-3 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Config Paths</p>
        <p className="text-xs font-mono text-text-secondary break-all">
          Runtime: {diagnostics?.paths.runtimeRoot ?? '-'}
        </p>
        <p className="text-xs font-mono text-text-secondary break-all">
          Apache Config: {diagnostics?.paths.apache.runtimeConfig ?? '-'}
        </p>
        <p className="text-xs font-mono text-text-secondary break-all">
          Apache Vhosts: {diagnostics?.paths.apache.vhostConfig ?? '-'}
        </p>
        <p className="text-xs font-mono text-text-secondary break-all">
          MySQL Data: {diagnostics?.paths.mysql.dataDir ?? '-'}
        </p>
        <p className="text-xs font-mono text-text-secondary break-all">
          PHP ini: {diagnostics?.paths.php.runtimeIniPath ?? '-'}
        </p>
      </div>
    </div>
  );
}
