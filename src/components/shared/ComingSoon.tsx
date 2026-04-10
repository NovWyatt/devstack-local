/**
 * ComingSoon — Placeholder Component for Future Phases
 *
 * Displays a styled "Coming Soon" message for routes that aren't
 * yet implemented. Will be replaced in later phases.
 */

import { Construction } from 'lucide-react';

interface ComingSoonProps {
  title: string;
}

export function ComingSoon({ title }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] animate-fade-in">
      {/* Icon container with subtle glow */}
      <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-accent-blue/10 mb-6">
        <Construction size={36} className="text-accent-blue" />
      </div>

      {/* Title */}
      <h2 className="text-2xl font-bold text-text-primary mb-2">{title}</h2>

      {/* Subtitle */}
      <p className="text-text-muted text-center max-w-md">
        This feature is under development and will be available in a future update.
        Stay tuned!
      </p>

      {/* Phase badge */}
      <div className="mt-6 px-4 py-2 rounded-full bg-accent-orange/10 border border-accent-orange/20">
        <span className="text-sm font-medium text-accent-orange">Coming in Phase 2+</span>
      </div>
    </div>
  );
}
