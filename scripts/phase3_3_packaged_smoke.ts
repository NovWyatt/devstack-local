import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import {
  getApacheLogDir,
  getApacheRuntimeConfigPath,
  getBundledBinaryRoots,
  getMySQLDataDir,
  getPhpRuntimeIniPath,
  resolveAppIconPath,
} from '../electron/utils/runtime.paths.ts';

type StepResult = {
  name: string;
  success: boolean;
  details: string;
};

interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface CommandSpec {
  command: string;
  args: string[];
}

const results: StepResult[] = [];

function pushResult(name: string, success: boolean, details: string): void {
  results.push({ name, success, details });
  const label = success ? 'PASS' : 'FAIL';
  console.log(`[${label}] ${name}: ${details}`);
}

function normalize(value: string): string {
  return path.resolve(value).toLowerCase();
}

function isSubPath(parentDir: string, targetPath: string): boolean {
  const parent = normalize(parentDir);
  const target = normalize(targetPath);
  return target === parent || target.startsWith(`${parent}${path.sep}`);
}

function summarizeOutput(output: string): string {
  const cleaned = output.trim();
  if (!cleaned) return '';
  const lines = cleaned.split(/\r?\n/);
  return lines.slice(-8).join(' | ');
}

function getNpmCommand(args: string[]): CommandSpec {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
  };
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('close', (code, signal) => {
      resolve({
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

async function runRequiredStep(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const details = await fn();
    pushResult(name, true, details);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    pushResult(name, false, details);
    throw error;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function findPhpCgiBinary(binariesRoot: string): string | null {
  const phpRoot = path.join(binariesRoot, 'php');
  if (!fs.existsSync(phpRoot)) return null;

  const versions = fs.readdirSync(phpRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const versionDir of versions) {
    const candidate = path.join(phpRoot, versionDir.name, 'php-cgi.exe');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function runPackagedAppSmoke(exePath: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(exePath, [], {
      cwd: path.dirname(exePath),
      env: {
        ...process.env,
        DEVSTACK_SMOKE_EXIT_MS: String(timeoutMs),
      },
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const killTimer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new Error(`Timed out waiting for packaged app to exit after ${timeoutMs}ms`));
    }, timeoutMs + 15000);

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.once('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      reject(error);
    });

    child.once('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      resolve({
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const outputPath = path.join(projectRoot, 'phase3_3_packaged_smoke_results.json');
  const releaseDir = path.join(projectRoot, 'release');
  const packagedRoot = path.join(projectRoot, 'release', 'win-unpacked');
  const resourcesDir = path.join(packagedRoot, 'resources');
  const binariesRoot = path.join(resourcesDir, 'binaries');
  const exePath = path.join(packagedRoot, 'DevStack Local.exe');

  try {
    await runRequiredStep('Clean packaged output', async () => {
      const releaseDirExisted = fs.existsSync(releaseDir);
      fs.rmSync(releaseDir, { recursive: true, force: true });
      assert(!fs.existsSync(packagedRoot), `Failed to clean stale packaged output: ${packagedRoot}`);
      return releaseDirExisted ? 'Removed stale release/ output before smoke run' : 'No stale release/ output found';
    });

    await runRequiredStep('Build web/electron bundles', async () => {
      const npmCommand = getNpmCommand(['run', 'build']);
      const result = await runCommand(npmCommand.command, npmCommand.args, projectRoot);
      if (result.code !== 0) {
        const details = summarizeOutput(result.stderr || result.stdout) || `exit code ${result.code}`;
        throw new Error(`npm run build failed (${details})`);
      }
      return 'npm run build completed';
    });

    await runRequiredStep('Build unpacked Windows package', async () => {
      const npmCommand = getNpmCommand([
        'exec',
        'electron-builder',
        '--',
        '--win',
        '--dir',
        '--publish',
        'never',
        '--config.win.signAndEditExecutable=false',
      ]);
      const result = await runCommand(
        npmCommand.command,
        npmCommand.args,
        projectRoot
      );
      if (result.code !== 0) {
        const details = summarizeOutput(result.stderr || result.stdout) || `exit code ${result.code}`;
        throw new Error(`electron-builder --win --dir failed (${details})`);
      }
      return 'release/win-unpacked generated';
    });

    await runRequiredStep('Verify packaged resources and binaries', async () => {
      const requiredPaths = [
        path.join(resourcesDir, 'app.asar'),
        path.join(resourcesDir, 'icon.ico'),
        path.join(binariesRoot, 'apache', 'bin', 'httpd.exe'),
        path.join(binariesRoot, 'mysql', 'bin', 'mysqld.exe'),
      ];

      for (const requiredPath of requiredPaths) {
        assert(fs.existsSync(requiredPath), `Missing packaged file: ${requiredPath}`);
      }

      const phpCgiPath = findPhpCgiBinary(binariesRoot);
      assert(phpCgiPath, 'Missing packaged PHP CGI binary under resources/binaries/php/*/php-cgi.exe');

      return `Validated app.asar, icon, Apache/MySQL binaries, and PHP CGI (${phpCgiPath})`;
    });

    await runRequiredStep('Verify packaged path resolution contract', async () => {
      const processWithResourcesPath = process as NodeJS.Process & { resourcesPath?: string };
      const originalResourcesPath = processWithResourcesPath.resourcesPath;
      processWithResourcesPath.resourcesPath = resourcesDir;

      try {
        const bundledRoots = getBundledBinaryRoots().map((item) => normalize(item));
        const expectedBundledRoot = normalize(path.join(resourcesDir, 'binaries'));
        assert(
          bundledRoots.includes(expectedBundledRoot),
          `Bundled binary roots do not include packaged resources path: ${expectedBundledRoot}`
        );

        const resolvedIconPath = normalize(resolveAppIconPath());
        const expectedIconPath = normalize(path.join(resourcesDir, 'icon.ico'));
        assert(
          resolvedIconPath === expectedIconPath,
          `resolveAppIconPath() resolved to ${resolvedIconPath}, expected ${expectedIconPath}`
        );
      } finally {
        processWithResourcesPath.resourcesPath = originalResourcesPath;
      }

      const mutablePaths = [
        getApacheRuntimeConfigPath(),
        getApacheLogDir(),
        getMySQLDataDir(),
        getPhpRuntimeIniPath('8.3.30'),
      ];

      for (const mutablePath of mutablePaths) {
        assert(
          !isSubPath(resourcesDir, mutablePath),
          `Mutable runtime path must not be inside packaged resources: ${mutablePath}`
        );
      }

      return 'Bundled resources resolve from resources/binaries and mutable paths stay outside packaged resources';
    });

    await runRequiredStep('Packaged app startup smoke exits cleanly', async () => {
      assert(fs.existsSync(exePath), `Packaged executable not found: ${exePath}`);

      const result = await runPackagedAppSmoke(exePath, 5000);
      if (result.code !== 0) {
        const details = summarizeOutput(result.stderr || result.stdout) || `exit code ${result.code}`;
        throw new Error(`Packaged app exited abnormally (${details})`);
      }

      return `Launched and exited cleanly: ${exePath}`;
    });
  } finally {
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`Saved packaged smoke results to ${outputPath}`);
  }

  if (results.some((item) => !item.success)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const details = error instanceof Error ? error.message : String(error);
  pushResult('Phase 3.3 packaged smoke runner', false, details);
  const outputPath = path.join(process.cwd(), 'phase3_3_packaged_smoke_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  process.exitCode = 1;
});
