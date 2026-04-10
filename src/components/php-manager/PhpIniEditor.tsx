/**
 * PhpIniEditor — Monaco-based php.ini Configuration Editor
 *
 * Provides a full-featured code editor for editing php.ini files.
 * Supports syntax highlighting, line numbers, find/replace, and
 * tracks unsaved changes with visual indicators.
 * Monaco Editor is lazy-loaded to avoid blocking initial render (~5MB).
 */

import { Suspense, lazy, useCallback } from 'react';
import { Save, RotateCcw, FileText, Loader2, AlertCircle } from 'lucide-react';
import { usePhpStore } from '../../stores/usePhpStore';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

/** Lazy-load Monaco Editor for code splitting */
const MonacoEditor = lazy(() => import('@monaco-editor/react'));

export function PhpIniEditor() {
  const phpIniContent = usePhpStore((s) => s.phpIniContent);
  const phpIniModified = usePhpStore((s) => s.phpIniModified);
  const loadingPhpIni = usePhpStore((s) => s.loadingPhpIni);
  const savingPhpIni = usePhpStore((s) => s.savingPhpIni);
  const activeVersion = usePhpStore((s) => s.activeVersion);
  const updatePhpIniContent = usePhpStore((s) => s.updatePhpIniContent);
  const savePhpIni = usePhpStore((s) => s.savePhpIni);
  const resetPhpIni = usePhpStore((s) => s.resetPhpIni);

  /** Handle editor content changes with the store updater */
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        updatePhpIniContent(value);
      }
    },
    [updatePhpIniContent]
  );

  /** Save the current php.ini content */
  const handleSave = async () => {
    const success = await savePhpIni();
    if (success) {
      toast.success(`php.ini saved for PHP ${activeVersion}`);
    } else {
      toast.error('Failed to save php.ini');
    }
  };

  /** Reset to last saved state with confirmation */
  const handleReset = () => {
    if (phpIniModified) {
      resetPhpIni();
      toast.info('php.ini reset to last saved state');
    }
  };

  if (loadingPhpIni) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-accent-blue" />
        <span className="ml-3 text-text-muted">Loading php.ini...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Editor Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-text-muted" />
          <span className="text-sm font-medium text-text-primary">
            php.ini
          </span>
          <span className="text-xs text-text-muted">— PHP {activeVersion}</span>

          {/* Unsaved indicator */}
          {phpIniModified && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-status-warning/10 border border-status-warning/20">
              <AlertCircle size={12} className="text-status-warning" />
              <span className="text-xs font-medium text-status-warning">
                Unsaved changes
              </span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            id="btn-reset-phpini"
            onClick={handleReset}
            disabled={!phpIniModified}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
              'border border-border-color',
              phpIniModified
                ? 'text-text-secondary hover:text-text-primary hover:bg-white/5'
                : 'text-text-muted/50 cursor-not-allowed'
            )}
          >
            <RotateCcw size={14} />
            Reset
          </button>
          <button
            id="btn-save-phpini"
            onClick={handleSave}
            disabled={!phpIniModified || savingPhpIni}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200',
              'border',
              phpIniModified
                ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/30 hover:bg-accent-blue/25'
                : 'bg-white/5 text-text-muted/50 border-border-color cursor-not-allowed'
            )}
          >
            {savingPhpIni ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {savingPhpIni ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* ─── Monaco Editor ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-border-color overflow-hidden">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-[500px] bg-[#1e1e1e]">
              <Loader2 size={24} className="animate-spin text-accent-blue" />
              <span className="ml-3 text-text-muted">Loading editor...</span>
            </div>
          }
        >
          <MonacoEditor
            height="calc(100vh - 360px)"
            language="ini"
            theme="vs-dark"
            value={phpIniContent}
            onChange={handleEditorChange}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: "'JetBrains Mono', Consolas, monospace",
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 4,
              wordWrap: 'on',
              renderLineHighlight: 'line',
              cursorBlinking: 'smooth',
              smoothScrolling: true,
              padding: { top: 16, bottom: 16 },
              lineDecorationsWidth: 16,
              bracketPairColorization: { enabled: true },
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
