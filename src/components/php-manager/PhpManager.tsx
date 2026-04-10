/**
 * PhpManager — Main PHP Manager Page
 *
 * Tabbed interface providing access to:
 * - Versions tab: PHP version management (install, activate, remove)
 * - php.ini tab: Configuration file editor
 * - Extensions tab: Extension toggle management
 *
 * Fetches version and extension data on mount.
 */

import { useEffect, useRef } from 'react';
import { Code2, CheckCircle2 } from 'lucide-react';
import { usePhpStore } from '../../stores/usePhpStore';
import { cn } from '../../lib/utils';
import { VersionList } from './VersionList';
import { PhpIniEditor } from './PhpIniEditor';
import { ExtensionManager } from './ExtensionManager';
import type { PhpManagerTab } from '../../types/php.types';

/** Tab definitions for the PHP Manager */
const TABS: Array<{ id: PhpManagerTab; label: string }> = [
  { id: 'versions', label: 'Versions' },
  { id: 'phpini', label: 'php.ini' },
  { id: 'extensions', label: 'Extensions' },
];

export function PhpManager() {
  const activeTab = usePhpStore((s) => s.activeTab);
  const setActiveTab = usePhpStore((s) => s.setActiveTab);
  const activeVersion = usePhpStore((s) => s.activeVersion);
  const fetchVersions = usePhpStore((s) => s.fetchVersions);
  const fetchExtensions = usePhpStore((s) => s.fetchExtensions);
  const loadPhpIni = usePhpStore((s) => s.loadPhpIni);
  const hasInitialized = useRef(false);

  // Fetch data on initial mount
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    fetchVersions();
    fetchExtensions(activeVersion);
    loadPhpIni(activeVersion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ─── Page Header ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent-blue/15">
            <Code2 size={20} className="text-accent-blue" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">
              PHP Environment Configuration
            </h1>
            <p className="text-sm text-text-muted">
              Manage PHP versions, extensions, and configuration
            </p>
          </div>
        </div>

        {/* Active version status */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-status-running/10 border border-status-running/20">
          <CheckCircle2 size={16} className="text-status-running" />
          <span className="text-sm font-medium text-status-running">
            PHP {activeVersion}
          </span>
          <span className="text-xs text-status-running/70">Active</span>
        </div>
      </div>

      {/* ─── Tab Navigation ────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-lg bg-white/[0.03] border border-border-color w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`php-tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-5 py-2 rounded-md text-sm font-medium transition-all duration-200',
              activeTab === tab.id
                ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/20'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/5 border border-transparent'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Tab Content ───────────────────────────────────────────── */}
      <div className="animate-fade-in">
        {activeTab === 'versions' && <VersionList />}
        {activeTab === 'phpini' && <PhpIniEditor />}
        {activeTab === 'extensions' && <ExtensionManager />}
      </div>
    </div>
  );
}
