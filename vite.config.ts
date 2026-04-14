import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

type ProjectPackageJson = {
  dependencies?: Record<string, string>;
};

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
) as ProjectPackageJson;
const configDir = path.dirname(fileURLToPath(import.meta.url));
const electronRuntimeDependencies = [
  ...new Set(['ssh2-sftp-client', 'ssh2', 'cpu-features', ...Object.keys(packageJson.dependencies ?? {})]),
];

function normalizeModuleId(source: string): string {
  return source
    .replace(/\\/g, '/')
    .replace(/\0/g, '')
    .replace(/^\/@id\//, '')
    .replace(/^commonjs-(?:external|proxy):/, '')
    .replace(/[?#].*$/, '');
}

function isElectronRuntimeDependency(source: string): boolean {
  const normalizedSource = normalizeModuleId(source);

  if (
    normalizedSource.endsWith('.node') ||
    normalizedSource.includes('/node_modules/')
  ) {
    return true;
  }

  return electronRuntimeDependencies.some((dependency) => {
    const normalizedDependency = normalizeModuleId(dependency);
    return (
      normalizedSource === normalizedDependency ||
      normalizedSource.startsWith(`${normalizedDependency}/`)
    );
  });
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron';

  return {
    plugins: [
      react(),
      ...(isElectron
        ? [
            electron([
              {
                entry: 'electron/main.ts',
                vite: {
                  resolve: {
                    preserveSymlinks: true,
                  },
                  build: {
                    outDir: 'dist-electron',
                    rollupOptions: {
                      // Electron runtime deps must stay external so native addons
                      // such as ssh2 -> cpu-features are loaded by Node at runtime.
                      external: isElectronRuntimeDependency,
                    },
                  },
                },
              },
              {
                entry: 'electron/preload.ts',
                onstart(options) {
                  options.reload();
                },
                vite: {
                  resolve: {
                    preserveSymlinks: true,
                  },
                  build: {
                    outDir: 'dist-electron',
                    rollupOptions: {
                      external: isElectronRuntimeDependency,
                    },
                  },
                },
              },
            ]),
            electronRenderer(),
          ]
        : []),
    ],
    resolve: {
      preserveSymlinks: true,
      alias: {
        '@': path.resolve(configDir, './src'),
      },
    },
    server: {
      port: 3000,
    },
  };
});
