/**
 * Runtime path utilities.
 *
 * Keeps bundled assets (binaries/icon) discoverable in both dev and packaged
 * modes, while routing writable runtime files to userData.
 */

import fs from 'fs';
import path from 'path';
import electron from 'electron';

interface ElectronAppLike {
  getPath?: (name: string) => string;
  getAppPath?: () => string;
}

function getElectronApp(): ElectronAppLike | null {
  try {
    return (electron as unknown as { app?: ElectronAppLike }).app ?? null;
  } catch {
    return null;
  }
}

function getAppPathSafe(): string {
  const app = getElectronApp();
  if (app?.getAppPath) {
    try {
      return app.getAppPath();
    } catch {
      // Fall through.
    }
  }
  return process.cwd();
}

function getUserDataSafe(): string {
  const app = getElectronApp();
  if (app?.getPath) {
    try {
      return app.getPath('userData');
    } catch {
      // Fall through.
    }
  }
  return path.join(process.cwd(), '.devstack-runtime');
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of paths) {
    const key = path.normalize(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export function ensureDir(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function toApachePath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function getRuntimeRoot(): string {
  const app = getElectronApp();
  if (app?.getPath) {
    return path.join(getUserDataSafe(), 'runtime');
  }
  return getUserDataSafe();
}

export function getApacheRuntimeDir(): string {
  return path.join(getRuntimeRoot(), 'apache');
}

export function getApacheRuntimeConfigPath(): string {
  return path.join(getApacheRuntimeDir(), 'httpd.devstack.conf');
}

export function getApacheVhostConfigPath(): string {
  return path.join(getApacheRuntimeDir(), 'httpd-devstack-vhosts.conf');
}

export function getApacheLogDir(): string {
  return path.join(getApacheRuntimeDir(), 'logs');
}

export function getApachePidFilePath(): string {
  return path.join(getApacheRuntimeDir(), 'httpd.pid');
}

export function getMySQLRuntimeDir(): string {
  return path.join(getRuntimeRoot(), 'mysql');
}

export function getMySQLDataDir(): string {
  return path.join(getMySQLRuntimeDir(), 'data');
}

export function getMySQLTmpDir(): string {
  return path.join(getMySQLRuntimeDir(), 'tmp');
}

export function getPhpRuntimeDir(version: string): string {
  return path.join(getRuntimeRoot(), 'php', version);
}

export function getPhpRuntimeIniPath(version: string): string {
  return path.join(getPhpRuntimeDir(version), 'php.ini');
}

export function getPhpBackupDir(version: string): string {
  return path.join(getPhpRuntimeDir(version), 'backups');
}

/**
 * Candidate roots that may contain bundled service binaries.
 *
 * Packaged mode:
 * - <resourcesPath>/binaries (preferred, from extraResources)
 * - <resourcesPath>/resources/binaries (legacy layout compatibility)
 *
 * Dev mode:
 * - <appPath>/resources/binaries
 * - <cwd>/resources/binaries
 */
export function getBundledBinaryRoots(): string[] {
  const candidates: string[] = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'binaries'));
    candidates.push(path.join(process.resourcesPath, 'resources', 'binaries'));
  }

  const appPath = getAppPathSafe();
  candidates.push(path.join(appPath, 'resources', 'binaries'));
  candidates.push(path.join(process.cwd(), 'resources', 'binaries'));

  return dedupePaths(candidates);
}

/**
 * Resolve app icon path for BrowserWindow and packaged smoke checks.
 */
export function resolveAppIconPath(): string {
  const candidates: string[] = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'icon.ico'));
    candidates.push(path.join(process.resourcesPath, 'public', 'icon.ico'));
  }

  const appPath = getAppPathSafe();
  candidates.push(path.join(appPath, 'public', 'icon.ico'));
  candidates.push(path.join(process.cwd(), 'public', 'icon.ico'));

  for (const candidate of dedupePaths(candidates)) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1] ?? path.join(process.cwd(), 'public', 'icon.ico');
}
