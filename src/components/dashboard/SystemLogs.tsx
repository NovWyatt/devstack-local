/**
 * SystemLogs — Terminal-style Log Viewer
 *
 * Displays real-time log entries with color-coded severity levels
 * in a terminal-like dark panel. Supports auto-scroll and clear functionality.
 */

import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { formatTime, cn } from '../../lib/utils';
import type { LogLevel } from '../../types';

/** Color mapping for log level tags */
const levelColors: Record<LogLevel, string> = {
  system: 'text-accent-blue',
  success: 'text-status-running',
  error: 'text-status-stopped',
  warning: 'text-status-warning',
};

/** Display text for log level tags */
const levelLabels: Record<LogLevel, string> = {
  system: 'SYSTEM',
  success: 'SUCCESS',
  error: 'ERROR',
  warning: 'WARNING',
};

export function SystemLogs() {
  const logs = useAppStore((state) => state.logs);
  const clearLogs = useAppStore((state) => state.clearLogs);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      id="system-logs"
      className="rounded-xl border border-border-color overflow-hidden"
    >
      {/* ─── Title Bar ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#1a1a2e] border-b border-border-color">
        <div className="flex items-center gap-3">
          {/* macOS-style traffic light dots */}
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-widest text-text-muted">
            System Logs
          </span>
        </div>

        {/* Clear logs button */}
        <button
          id="clear-logs"
          onClick={clearLogs}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-text-muted hover:text-text-primary hover:bg-white/5 transition-all duration-200"
          title="Clear logs"
        >
          <Trash2 size={12} />
          Clear
        </button>
      </div>

      {/* ─── Log Content ─────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="max-h-[300px] overflow-y-auto bg-[#0d0d14] p-4 font-mono text-sm"
      >
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-text-muted text-xs">
            No log entries yet. Start a service to see logs.
          </div>
        ) : (
          <div className="space-y-1">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 py-0.5 animate-fade-in"
              >
                {/* Timestamp */}
                <span className="text-text-muted whitespace-nowrap text-xs leading-5">
                  {formatTime(new Date(log.timestamp))}
                </span>

                {/* Level tag */}
                <span
                  className={cn(
                    'text-xs font-bold whitespace-nowrap leading-5',
                    levelColors[log.level]
                  )}
                >
                  [{levelLabels[log.level]}]
                </span>

                {/* Message */}
                <span className="text-text-secondary text-xs leading-5">
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Blinking cursor at the bottom for terminal feel */}
        <div className="flex items-center mt-2">
          <span className="text-accent-blue text-xs mr-1">❯</span>
          <span className="w-2 h-4 bg-accent-blue/70 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
