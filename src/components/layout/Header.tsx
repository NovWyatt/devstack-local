/**
 * Header — Top Bar Component
 *
 * Displays the current page title, a theme toggle placeholder,
 * and a user account badge with plan info.
 */

import { useLocation } from 'react-router-dom';
import { Sun, Moon, User } from 'lucide-react';
import { useState } from 'react';

/** Map route paths to display titles */
const routeTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/php-manager': 'PHP Manager',
  '/domains': 'Domains',
  '/database': 'Database',
  '/ssh-ftp': 'SSH / FTP',
  '/system-logs': 'System Logs',
  '/tunnel': 'Tunnel',
  '/settings': 'Settings',
};

export function Header() {
  const location = useLocation();
  const [isDarkMode, setIsDarkMode] = useState(true);

  const pageTitle = routeTitles[location.pathname] || 'DevStack';

  return (
    <header
      id="header"
      className="flex items-center justify-between h-16 min-h-[64px] px-6 bg-bg-secondary border-b border-border-color"
    >
      {/* Page title */}
      <h2 className="text-lg font-semibold text-text-primary">{pageTitle}</h2>

      {/* Right side controls */}
      <div className="flex items-center gap-4">
        {/* Theme toggle (visual only for Phase 1) */}
        <button
          id="theme-toggle"
          onClick={() => setIsDarkMode(!isDarkMode)}
          className="flex items-center justify-center w-9 h-9 rounded-lg text-text-muted hover:text-text-primary hover:bg-white/5 transition-all duration-200"
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* User badge */}
        <div
          id="user-badge"
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-white/5 border border-border-color"
        >
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-accent-blue/20">
            <User size={14} className="text-accent-blue" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">wyatt</span>
            <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-accent-orange/20 text-accent-orange">
              Free
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
