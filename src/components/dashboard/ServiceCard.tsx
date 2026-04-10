/**
 * ServiceCard — Individual Service Control Card
 *
 * Displays service status, version, port, PID, and provides
 * start/stop functionality with loading states and status indicators.
 */

import { Server, Database, Loader2 } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { usePhpStore } from '../../stores/usePhpStore';
import { cn } from '../../lib/utils';
import type { ServiceName } from '../../types';

interface ServiceCardProps {
  service: ServiceName;
}

/** Service-specific display configuration */
const serviceConfig = {
  apache: {
    name: 'Apache',
    icon: Server,
    description: 'Web Server',
  },
  mysql: {
    name: 'MySQL',
    icon: Database,
    description: 'Database Server',
  },
} as const;

export function ServiceCard({ service }: ServiceCardProps) {
  const serviceState = useAppStore((state) => state[service]);
  const startService = useAppStore((state) => state.startService);
  const stopService = useAppStore((state) => state.stopService);
  const phpActiveVersion = usePhpStore((state) => state.activeVersion);

  const config = serviceConfig[service];
  const Icon = config.icon;

  const isRunning = serviceState.status === 'running';
  const isStopped = serviceState.status === 'stopped';
  const isTransitioning = serviceState.status === 'starting' || serviceState.status === 'stopping';

  /** Handle the start/stop toggle button */
  const handleToggle = async () => {
    if (isTransitioning) return;

    if (isRunning) {
      await stopService(service);
    } else {
      await startService(service);
    }
  };

  /** Get the status badge text and color */
  const getStatusBadge = () => {
    switch (serviceState.status) {
      case 'running':
        return { text: 'Running', colorClass: 'bg-status-running/15 text-status-running border-status-running/30' };
      case 'stopped':
        return { text: 'Stopped', colorClass: 'bg-status-stopped/15 text-status-stopped border-status-stopped/30' };
      case 'starting':
        return { text: 'Starting...', colorClass: 'bg-status-warning/15 text-status-warning border-status-warning/30' };
      case 'stopping':
        return { text: 'Stopping...', colorClass: 'bg-status-warning/15 text-status-warning border-status-warning/30' };
    }
  };

  const badge = getStatusBadge();

  return (
    <div
      id={`service-card-${service}`}
      className={cn(
        'relative rounded-xl p-6 border transition-all duration-300',
        'bg-bg-card border-border-color',
        isRunning && 'border-status-running/20 shadow-[0_0_20px_rgba(16,185,129,0.08)]',
        isStopped && 'border-border-color',
        isTransitioning && 'border-status-warning/20'
      )}
    >
      {/* ─── Header: Icon + Name + Status Badge ──────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-300',
              isRunning ? 'bg-status-running/15' : 'bg-white/5'
            )}
          >
            <Icon
              size={20}
              className={cn(
                'transition-colors duration-300',
                isRunning ? 'text-status-running' : 'text-text-muted'
              )}
            />
          </div>
          <div>
            <h3 className="text-base font-semibold text-text-primary">{config.name}</h3>
            <p className="text-xs text-text-muted">{config.description}</p>
          </div>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span className={cn('status-dot', `status-dot--${serviceState.status}`)} />
          <span
            className={cn(
              'px-2.5 py-1 text-xs font-semibold rounded-md border',
              badge.colorClass
            )}
          >
            {badge.text}
          </span>
        </div>
      </div>

      {/* ─── Info Rows ───────────────────────────────────────────── */}
      <div className="space-y-3 mb-6">
        <InfoRow label="Version" value={serviceState.version} />
        <InfoRow label="Port listening" value={String(serviceState.port)} />
        <InfoRow
          label="Process ID"
          value={serviceState.pid ? String(serviceState.pid) : '—'}
          muted={!serviceState.pid}
        />
        {/* Show PHP version on the Apache card */}
        {service === 'apache' && (
          <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.03]">
            <span className="text-sm text-text-muted">PHP Version</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium font-mono text-text-primary">
                {phpActiveVersion}
              </span>
              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded bg-accent-blue/15 text-accent-blue border border-accent-blue/20">
                Active
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Start / Stop Button ─────────────────────────────────── */}
      <button
        id={`btn-toggle-${service}`}
        onClick={handleToggle}
        disabled={isTransitioning}
        className={cn(
          'flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold transition-all duration-200',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          isRunning
            ? 'bg-status-stopped/15 text-status-stopped border border-status-stopped/30 hover:bg-status-stopped/25'
            : 'bg-accent-blue/15 text-accent-blue border border-accent-blue/30 hover:bg-accent-blue/25',
          isTransitioning && 'bg-status-warning/15 text-status-warning border-status-warning/30'
        )}
      >
        {isTransitioning ? (
          <>
            <Loader2 size={16} className="animate-spin-slow" />
            {serviceState.status === 'starting' ? 'Starting...' : 'Stopping...'}
          </>
        ) : isRunning ? (
          'Stop'
        ) : (
          'Start'
        )}
      </button>
    </div>
  );
}

/* ─── Info Row Sub-Component ──────────────────────────────────────── */

interface InfoRowProps {
  label: string;
  value: string;
  muted?: boolean;
}

function InfoRow({ label, value, muted = false }: InfoRowProps) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.03]">
      <span className="text-sm text-text-muted">{label}</span>
      <span
        className={cn(
          'text-sm font-medium font-mono',
          muted ? 'text-text-muted' : 'text-text-primary'
        )}
      >
        {value}
      </span>
    </div>
  );
}
