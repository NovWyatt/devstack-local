/**
 * Sidebar — Fixed Left Navigation
 *
 * Contains the app logo/version, navigation menu with icons,
 * and an exit application button at the bottom.
 * Active route is highlighted with a blue accent.
 */

import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Code2,
  Globe,
  Database,
  Server,
  ScrollText,
  Network,
  Settings,
  LogOut,
  Zap,
} from 'lucide-react';
import { cn } from '../../lib/utils';

/** Navigation menu item definition */
interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

/** All sidebar navigation items */
const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: <LayoutDashboard size={18} /> },
  { label: 'PHP Manager', path: '/php-manager', icon: <Code2 size={18} /> },
  { label: 'Domains', path: '/domains', icon: <Globe size={18} /> },
  { label: 'Database', path: '/database', icon: <Database size={18} /> },
  { label: 'SSH / FTP', path: '/ssh-ftp', icon: <Server size={18} /> },
  { label: 'System Logs', path: '/system-logs', icon: <ScrollText size={18} /> },
  { label: 'Tunnel', path: '/tunnel', icon: <Network size={18} /> },
  { label: 'Settings', path: '/settings', icon: <Settings size={18} /> },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * Handle exit application click.
   * In Electron, this triggers a confirmation dialog then graceful shutdown.
   * In browser, just logs to console.
   */
  const handleExit = async () => {
    if (window.electronAPI && 'exitApp' in window.electronAPI) {
      await (window.electronAPI as unknown as { exitApp: () => Promise<void> }).exitApp();
    } else {
      // Browser fallback — just log a message
      console.log('[DevStack] Exit application requested (browser mode — no-op)');
    }
  };

  return (
    <aside
      id="sidebar"
      className="flex flex-col w-[240px] min-w-[240px] h-full bg-bg-secondary border-r border-border-color"
    >
      {/* ─── Logo & Version ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-border-color">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent-blue/20">
          <Zap size={20} className="text-accent-blue" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-text-primary tracking-tight">
            DevStack
          </h1>
          <p className="text-xs text-text-muted">v0.1.0</p>
        </div>
      </div>

      {/* ─── Navigation Menu ────────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;

          return (
            <button
              key={item.path}
              id={`nav-${item.label.toLowerCase().replace(/[\s\/]/g, '-')}`}
              onClick={() => navigate(item.path)}
              className={cn(
                'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/20'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/5 border border-transparent'
              )}
            >
              <span
                className={cn(
                  'transition-colors duration-200',
                  isActive ? 'text-accent-blue' : 'text-text-muted'
                )}
              >
                {item.icon}
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* ─── Exit Button ────────────────────────────────────────────── */}
      <div className="px-3 pb-4">
        <button
          id="exit-application"
          onClick={handleExit}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-status-stopped/80 hover:text-status-stopped hover:bg-status-stopped/10 border border-transparent hover:border-status-stopped/20 transition-all duration-200"
        >
          <LogOut size={18} />
          Exit Application
        </button>
      </div>
    </aside>
  );
}
