/**
 * ExtensionManager — PHP Extension Toggle List
 *
 * Displays all common PHP extensions with toggle switches.
 * Required/core extensions are shown as locked (cannot be disabled).
 * Toggling an extension modifies the php.ini configuration.
 */

import { Shield, Loader2 } from 'lucide-react';
import { usePhpStore } from '../../stores/usePhpStore';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

export function ExtensionManager() {
  const extensions = usePhpStore((s) => s.extensions);
  const activeVersion = usePhpStore((s) => s.activeVersion);
  const toggleExtension = usePhpStore((s) => s.toggleExtension);
  const togglingExtension = usePhpStore((s) => s.togglingExtension);

  /** Handle extension toggle */
  const handleToggle = async (extensionName: string, enabled: boolean) => {
    const success = await toggleExtension(extensionName, enabled);
    const action = enabled ? 'enabled' : 'disabled';
    if (success) {
      toast.success(`Extension ${extensionName} ${action}`);
    } else {
      toast.error(`Failed to ${enabled ? 'enable' : 'disable'} ${extensionName}`);
    }
  };

  if (extensions.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-accent-blue" />
        <span className="ml-3 text-text-muted">Loading extensions...</span>
      </div>
    );
  }

  // Separate required and optional extensions for visual grouping
  const requiredExtensions = extensions.filter((e) => e.required);
  const optionalExtensions = extensions.filter((e) => !e.required);

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-accent-blue/5 border border-accent-blue/15">
        <Shield size={16} className="text-accent-blue flex-shrink-0" />
        <p className="text-sm text-text-secondary">
          Extensions for <span className="font-semibold text-text-primary">PHP {activeVersion}</span>.
          Required extensions cannot be disabled.
        </p>
      </div>

      {/* Required extensions */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
          Required Extensions
        </h3>
        <div className="space-y-2">
          {requiredExtensions.map((ext) => (
            <ExtensionRow
              key={ext.name}
              name={ext.name}
              description={ext.description}
              enabled={ext.enabled}
              required={ext.required}
              toggling={togglingExtension === ext.name}
              onToggle={(enabled) => handleToggle(ext.name, enabled)}
            />
          ))}
        </div>
      </div>

      {/* Optional extensions */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
          Optional Extensions
        </h3>
        <div className="space-y-2">
          {optionalExtensions.map((ext) => (
            <ExtensionRow
              key={ext.name}
              name={ext.name}
              description={ext.description}
              enabled={ext.enabled}
              required={ext.required}
              toggling={togglingExtension === ext.name}
              onToggle={(enabled) => handleToggle(ext.name, enabled)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Extension Row Sub-Component ─────────────────────────────────── */

interface ExtensionRowProps {
  name: string;
  description: string;
  enabled: boolean;
  required: boolean;
  toggling: boolean;
  onToggle: (enabled: boolean) => void;
}

function ExtensionRow({
  name,
  description,
  enabled,
  required,
  toggling,
  onToggle,
}: ExtensionRowProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-3.5 rounded-lg border transition-all duration-200',
        'bg-bg-card',
        enabled ? 'border-status-running/15' : 'border-border-color',
        !required && 'hover:border-border-color-hover'
      )}
    >
      {/* Extension info */}
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary font-mono">
              {name}
            </span>
            {required && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-accent-orange/15 text-accent-orange border border-accent-orange/20">
                Required
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
        </div>
      </div>

      {/* Toggle switch */}
      <div className="flex items-center">
        {toggling ? (
          <Loader2 size={16} className="animate-spin text-accent-blue" />
        ) : (
          <button
            onClick={() => !required && onToggle(!enabled)}
            disabled={required}
            className={cn(
              'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200 focus:outline-none',
              required && 'opacity-60 cursor-not-allowed',
              !required && 'cursor-pointer',
              enabled ? 'bg-status-running' : 'bg-white/10'
            )}
            role="switch"
            aria-checked={enabled}
            aria-label={`Toggle ${name} extension`}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition-transform duration-200 ease-in-out mt-0.5',
                enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              )}
            />
          </button>
        )}
      </div>
    </div>
  );
}
