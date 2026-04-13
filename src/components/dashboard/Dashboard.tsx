/**
 * Dashboard — Main Dashboard Page
 *
 * Displays the Apache and MySQL service cards in a 2-column grid,
 * followed by the full-width System Logs viewer.
 */

import { ServiceCard } from './ServiceCard';
import { HealthDiagnosticsPanel } from './HealthDiagnosticsPanel';
import { SystemLogs } from './SystemLogs';

export function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Service Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ServiceCard service="apache" />
        <ServiceCard service="mysql" />
      </div>

      <HealthDiagnosticsPanel />

      {/* System Logs Panel */}
      <SystemLogs />
    </div>
  );
}
