/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#0a0e1a',
        'bg-secondary': '#131829',
        'bg-tertiary': '#1a2035',
        'bg-card': '#1a2035',
        'accent-blue': '#3b82f6',
        'accent-orange': '#ff8c42',
        'text-primary': '#f3f4f6',
        'text-secondary': '#9ca3af',
        'text-muted': '#6b7280',
        'status-running': '#10b981',
        'status-stopped': '#ef4444',
        'status-warning': '#f59e0b',
        'border-color': 'rgba(255, 255, 255, 0.1)',
        'border-color-hover': 'rgba(255, 255, 255, 0.2)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
