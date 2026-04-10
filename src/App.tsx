/**
 * App — Root Application Component
 *
 * Sets up routing and the application layout shell.
 * Initializes IPC listeners on mount and cleans them up on unmount.
 */

import { useEffect, useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './components/dashboard/Dashboard';
import { PhpManager } from './components/php-manager/PhpManager';
import { ComingSoon } from './components/shared/ComingSoon';
import { useAppStore } from './stores/useAppStore';

function App() {
  const { initIpcListeners, cleanupIpcListeners, addLog, clearLogs } = useAppStore();
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Guard against React StrictMode's double-mount in development
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    // Initialize IPC listeners for Electron environment
    initIpcListeners();

    // Clear any stale logs and emit startup sequence
    clearLogs();

    // Emit startup logs (mock)
    const startupLogs = [
      { level: 'system' as const, message: 'Starting DevStack Server...' },
      { level: 'system' as const, message: 'Checking service status...' },
      { level: 'success' as const, message: 'Apache service ready' },
      { level: 'success' as const, message: 'MySQL service ready' },
      { level: 'system' as const, message: 'Waiting for commands...' },
    ];

    // Stagger startup logs for a realistic feel
    const timeoutIds = startupLogs.map((log, index) =>
      setTimeout(() => addLog(log), (index + 1) * 400)
    );

    return () => {
      timeoutIds.forEach(clearTimeout);
      cleanupIpcListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/php-manager" element={<PhpManager />} />
        <Route path="/domains" element={<ComingSoon title="Domains" />} />
        <Route path="/database" element={<ComingSoon title="Database" />} />
        <Route path="/ssh-ftp" element={<ComingSoon title="SSH / FTP" />} />
        <Route path="/system-logs" element={<ComingSoon title="System Logs" />} />
        <Route path="/tunnel" element={<ComingSoon title="Tunnel" />} />
        <Route path="/settings" element={<ComingSoon title="Settings" />} />
      </Routes>
    </Layout>
  );
}

export default App;
