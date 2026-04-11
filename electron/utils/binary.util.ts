/**
 * Executable path validation utilities.
 */

import fs from 'fs';
import path from 'path';

const WINDOWS_EXECUTABLE_EXTENSIONS = new Set(['.exe', '.cmd', '.bat', '.com']);

/**
 * Validate that a binary path exists and is executable.
 *
 * Throws a descriptive error when invalid.
 */
export function assertExecutable(binaryPath: string, label: string): void {
  if (!binaryPath || !binaryPath.trim()) {
    throw new Error(`${label} binary path is empty`);
  }

  const resolvedPath = path.resolve(binaryPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`${label} binary not found at: ${resolvedPath}`);
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) {
    throw new Error(`${label} binary path is not a file: ${resolvedPath}`);
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  if (process.platform === 'win32' && !WINDOWS_EXECUTABLE_EXTENSIONS.has(extension)) {
    throw new Error(
      `${label} binary is not executable on Windows (expected .exe/.cmd/.bat/.com): ${resolvedPath}`
    );
  }

  try {
    fs.accessSync(resolvedPath, fs.constants.R_OK | fs.constants.X_OK);
  } catch {
    // On Windows, X_OK may be unreliable for some ACL combinations.
    try {
      fs.accessSync(resolvedPath, fs.constants.R_OK);
    } catch {
      throw new Error(`${label} binary is not accessible/executable: ${resolvedPath}`);
    }
  }
}
