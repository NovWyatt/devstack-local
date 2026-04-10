import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility function for merging Tailwind CSS class names.
 * Combines clsx (conditional class joining) with tailwind-merge
 * (deduplication of conflicting Tailwind utilities).
 *
 * @example
 * cn('px-4 py-2', isActive && 'bg-blue-500', 'px-6')
 * // Returns: 'py-2 px-6 bg-blue-500' (px-4 merged into px-6)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Generate a unique ID for log entries and other entities.
 * Uses a combination of timestamp and random string for uniqueness.
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Format a Date object to HH:mm:ss string for log timestamps.
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
