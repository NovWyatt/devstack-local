/**
 * VersionDownloader — PHP Download Progress Dialog
 *
 * Modal overlay that shows a progress bar during PHP version download.
 * Simulates the download in browser mode; uses IPC in Electron mode.
 * Closes automatically on completion and refreshes the version list.
 */

import { useEffect, useRef } from 'react';
import { X, Download, CheckCircle2, Loader2 } from 'lucide-react';
import { usePhpStore } from '../../stores/usePhpStore';
import { toast } from 'sonner';

interface VersionDownloaderProps {
  version: string;
  onClose: () => void;
}

export function VersionDownloader({ version, onClose }: VersionDownloaderProps) {
  const downloadVersion = usePhpStore((s) => s.downloadVersion);
  const downloadProgress = usePhpStore((s) => s.downloadProgress);
  const downloadingVersion = usePhpStore((s) => s.downloadingVersion);
  const hasStarted = useRef(false);

  // Start download on mount
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const doDownload = async () => {
      const success = await downloadVersion(version);
      if (success) {
        toast.success(`PHP ${version} installed successfully!`);
        // Small delay before closing for the user to see 100%
        setTimeout(onClose, 800);
      } else {
        toast.error(`Failed to install PHP ${version}`);
        onClose();
      }
    };

    doDownload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isComplete = downloadProgress >= 100 && !downloadingVersion;
  const sizeMap: Record<string, string> = {
    '8.5.1': '32 MB',
    '8.5.0': '32 MB',
    '8.3.29': '30 MB',
    '7.4.30': '28 MB',
    '5.6.9': '24 MB',
  };
  const totalSize = sizeMap[version] ?? '30 MB';
  const downloadedSize = `${Math.round(
    (downloadProgress / 100) * parseInt(totalSize)
  )} MB`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-xl bg-bg-secondary border border-border-color p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent-blue/15">
              <Download size={20} className="text-accent-blue" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-primary">
                Installing PHP {version}
              </h3>
              <p className="text-xs text-text-muted">Downloading from windows.php.net</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-text-muted hover:text-text-primary hover:bg-white/5 transition-all"
            title="Cancel download"
          >
            <X size={16} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-text-secondary">
              {isComplete ? 'Installation complete' : 'Downloading...'}
            </span>
            <span className="text-sm font-mono text-text-primary">
              {downloadProgress}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${downloadProgress}%`,
                background: isComplete
                  ? 'linear-gradient(90deg, #10b981, #34d399)'
                  : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
              }}
            />
          </div>
        </div>

        {/* Size info */}
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            {downloadedSize} / {totalSize}
          </span>
          <span className="flex items-center gap-1.5">
            {isComplete ? (
              <>
                <CheckCircle2 size={12} className="text-status-running" />
                <span className="text-status-running">Complete</span>
              </>
            ) : (
              <>
                <Loader2 size={12} className="animate-spin text-accent-blue" />
                <span>php-{version}-Win32-vs16-x64.zip</span>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
