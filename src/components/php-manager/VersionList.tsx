/**
 * VersionList — PHP Version Grid
 *
 * Displays all available PHP versions in a responsive grid.
 * Each card shows version info, installation status, and action buttons
 * (activate, download, or remove).
 */

import { useState } from 'react';
import { Download, Check, Trash2, Loader2, Zap } from 'lucide-react';
import { usePhpStore } from '../../stores/usePhpStore';
import { cn } from '../../lib/utils';
import { VersionDownloader } from './VersionDownloader';
import { toast } from 'sonner';
import type { PhpVersion } from '../../types/php.types';

export function VersionList() {
  const versions = usePhpStore((s) => s.versions);
  const loadingVersions = usePhpStore((s) => s.loadingVersions);
  const setActiveVersion = usePhpStore((s) => s.setActiveVersion);
  const removeVersion = usePhpStore((s) => s.removeVersion);
  const loadPhpIni = usePhpStore((s) => s.loadPhpIni);
  const fetchExtensions = usePhpStore((s) => s.fetchExtensions);

  const [activatingVersion, setActivatingVersion] = useState<string | null>(null);
  const [downloadingVersion, setDownloadingVersion] = useState<string | null>(null);
  const [removingVersion, setRemovingVersion] = useState<string | null>(null);

  /** Activate a PHP version */
  const handleActivate = async (version: string) => {
    setActivatingVersion(version);
    const success = await setActiveVersion(version);
    if (success) {
      toast.success(`PHP ${version} activated successfully`);
      // Reload php.ini and extensions for the newly active version
      await loadPhpIni(version);
      await fetchExtensions(version);
    } else {
      toast.error(`Failed to activate PHP ${version}`);
    }
    setActivatingVersion(null);
  };

  /** Remove an installed version */
  const handleRemove = async (version: string) => {
    setRemovingVersion(version);
    const success = await removeVersion(version);
    if (success) {
      toast.success(`PHP ${version} removed`);
    } else {
      toast.error(`Cannot remove PHP ${version}`);
    }
    setRemovingVersion(null);
  };

  if (loadingVersions) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-accent-blue" />
        <span className="ml-3 text-text-muted">Loading PHP versions...</span>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {versions.map((version) => (
          <VersionCard
            key={version.version}
            version={version}
            activating={activatingVersion === version.version}
            removing={removingVersion === version.version}
            onActivate={() => handleActivate(version.version)}
            onDownload={() => setDownloadingVersion(version.version)}
            onRemove={() => handleRemove(version.version)}
          />
        ))}
      </div>

      {/* Download dialog */}
      {downloadingVersion && (
        <VersionDownloader
          version={downloadingVersion}
          onClose={() => setDownloadingVersion(null)}
        />
      )}
    </>
  );
}

/* ─── Version Card Sub-Component ──────────────────────────────────── */

interface VersionCardProps {
  version: PhpVersion;
  activating: boolean;
  removing: boolean;
  onActivate: () => void;
  onDownload: () => void;
  onRemove: () => void;
}

function VersionCard({
  version,
  activating,
  removing,
  onActivate,
  onDownload,
  onRemove,
}: VersionCardProps) {
  /** Determine the status badge */
  const getStatusBadge = () => {
    if (version.active) {
      return {
        text: 'ACTIVE',
        className: 'bg-accent-blue/15 text-accent-blue border-accent-blue/30',
      };
    }
    if (version.installed) {
      return {
        text: 'Installed',
        className: 'bg-status-running/15 text-status-running border-status-running/30',
      };
    }
    return {
      text: 'Available',
      className: 'bg-white/5 text-text-muted border-border-color',
    };
  };

  const badge = getStatusBadge();

  return (
    <div
      className={cn(
        'rounded-xl p-5 border transition-all duration-300 hover:border-border-color-hover',
        'bg-bg-card',
        version.active
          ? 'border-accent-blue/25 shadow-[0_0_20px_rgba(59,130,246,0.08)]'
          : 'border-border-color'
      )}
    >
      {/* Header: version + badge */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-text-primary font-mono">
            {version.version}
          </span>
        </div>
        <span
          className={cn(
            'px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border',
            badge.className
          )}
        >
          {badge.text}
        </span>
      </div>

      {/* Info */}
      <div className="space-y-2 mb-5">
        <div className="flex justify-between text-sm">
          <span className="text-text-muted">Size</span>
          <span className="text-text-secondary font-mono">{version.size}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-muted">Status</span>
          <span className={cn(
            'text-sm',
            version.installed ? 'text-status-running' : 'text-text-muted'
          )}>
            {version.installed ? 'Installed' : 'Not installed'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {version.active ? (
          /* Currently active — show disabled badge */
          <div className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-medium bg-accent-blue/10 text-accent-blue/60 border border-accent-blue/15">
            <Zap size={14} />
            Current Version
          </div>
        ) : version.installed ? (
          /* Installed but not active — show activate + remove */
          <div className="flex gap-2">
            <button
              onClick={onActivate}
              disabled={activating}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-accent-blue/15 text-accent-blue border border-accent-blue/30 hover:bg-accent-blue/25 transition-all duration-200 disabled:opacity-50"
            >
              {activating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {activating ? 'Activating...' : 'Activate'}
            </button>
            <button
              onClick={onRemove}
              disabled={removing}
              className="flex items-center justify-center w-10 py-2.5 rounded-lg text-sm bg-status-stopped/10 text-status-stopped border border-status-stopped/20 hover:bg-status-stopped/20 transition-all duration-200 disabled:opacity-50"
              title="Remove this version"
            >
              {removing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
            </button>
          </div>
        ) : (
          /* Not installed — show download */
          <button
            onClick={onDownload}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold bg-white/5 text-text-secondary border border-border-color hover:bg-white/10 hover:text-text-primary transition-all duration-200"
          >
            <Download size={14} />
            Download ({version.size})
          </button>
        )}
      </div>
    </div>
  );
}
