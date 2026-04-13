import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  ensureDir,
  getApacheLogDir,
  getApacheRuntimeConfigPath,
  getApacheRuntimeDir,
  getApacheVhostConfigPath,
  getMySQLDataDir,
  getMySQLRuntimeDir,
  getMySQLTmpDir,
  getPhpRuntimeDir,
  getPhpRuntimeIniPath,
  getRuntimeRoot,
} from '../electron/utils/runtime.paths';

type TestResult = {
  name: string;
  success: boolean;
  details: string;
};

type ElectronBuilderConfig = {
  extraResources?: Array<{ from?: string; to?: string; filter?: string[] }>;
  win?: { target?: string[] };
  nsis?: { deleteAppDataOnUninstall?: boolean };
};

const results: TestResult[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, fn: () => string): void {
  try {
    const details = fn();
    results.push({ name, success: true, details });
    console.log(`[PASS] ${name}: ${details}`);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    results.push({ name, success: false, details });
    console.error(`[FAIL] ${name}: ${details}`);
  }
}

function normalize(absPath: string): string {
  return path.resolve(absPath).toLowerCase();
}

function isSubPath(parentDir: string, targetPath: string): boolean {
  const parent = normalize(parentDir);
  const target = normalize(targetPath);
  return target === parent || target.startsWith(`${parent}${path.sep}`);
}

function readElectronBuilderConfig(projectRoot: string): ElectronBuilderConfig {
  const configPath = path.join(projectRoot, 'electron-builder.json');
  assert(fs.existsSync(configPath), `Missing electron-builder config: ${configPath}`);
  return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ElectronBuilderConfig;
}

function findBinariesResourceFilter(config: ElectronBuilderConfig): string[] {
  const entry = (config.extraResources ?? []).find(
    (item) => item.from === 'resources/binaries' && item.to === 'binaries'
  );
  assert(entry, 'Missing extraResources mapping from resources/binaries to binaries');
  return entry.filter ?? [];
}

function listTrackedBinaryFiles(projectRoot: string): string[] {
  const output = execFileSync('git', ['ls-files', 'resources/binaries'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    windowsHide: true,
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function findPhpBinaryVersions(binariesRoot: string): string[] {
  const phpRoot = path.join(binariesRoot, 'php');
  if (!fs.existsSync(phpRoot)) {
    return [];
  }

  const versions = fs
    .readdirSync(phpRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  return versions.filter((version) => {
    const phpExe = path.join(phpRoot, version, 'php.exe');
    const phpCgiExe = path.join(phpRoot, version, 'php-cgi.exe');
    return fs.existsSync(phpExe) && fs.existsSync(phpCgiExe);
  });
}

function main(): void {
  const projectRoot = process.cwd();
  const outputPath = path.join(projectRoot, 'phase4_5_release_checks_results.json');
  const binariesRoot = path.join(projectRoot, 'resources', 'binaries');

  runTest('electron-builder NSIS release contract', () => {
    const config = readElectronBuilderConfig(projectRoot);
    const winTargets = config.win?.target ?? [];
    assert(winTargets.includes('nsis'), `Expected win.target to include "nsis", got: ${JSON.stringify(winTargets)}`);

    assert(
      config.nsis?.deleteAppDataOnUninstall === false,
      'Expected nsis.deleteAppDataOnUninstall=false to preserve runtime data on uninstall'
    );

    return 'NSIS target is configured and uninstall keeps app data';
  });

  runTest('packaging excludes mutable runtime artifact patterns', () => {
    const config = readElectronBuilderConfig(projectRoot);
    const filters = findBinariesResourceFilter(config);
    const expectedExclusions = [
      '!apache/logs/**',
      '!apache/conf/httpd.devstack.conf',
      '!apache/conf/extra/httpd-devstack-vhosts.conf',
      '!mysql/data/**',
      '!mysql/tmp/**',
      '!php/*/php.ini',
      '!php/*/php.ini.bak',
      '!php/*/backups/**',
      '!php/*/logs/**',
      '!php/*/tmp/**',
      '!php/*/sessions/**',
    ];

    const missing = expectedExclusions.filter((rule) => !filters.includes(rule));
    assert(missing.length === 0, `Missing packaging exclusions: ${missing.join(', ')}`);

    return `Validated ${expectedExclusions.length} mutable path exclusions`;
  });

  runTest('required bundled binaries are present in repo resources', () => {
    const requiredPaths = [
      path.join(binariesRoot, 'apache', 'bin', 'httpd.exe'),
      path.join(binariesRoot, 'mysql', 'bin', 'mysqld.exe'),
      path.join(binariesRoot, 'mysql', 'bin', 'mysql.exe'),
      path.join(binariesRoot, 'mysql', 'bin', 'mysqldump.exe'),
    ];

    for (const requiredPath of requiredPaths) {
      assert(fs.existsSync(requiredPath), `Missing bundled binary: ${requiredPath}`);
    }

    const phpVersions = findPhpBinaryVersions(binariesRoot);
    assert(
      phpVersions.length > 0,
      'Missing bundled PHP binaries with php.exe and php-cgi.exe under resources/binaries/php/*'
    );

    return `Core binaries found; PHP versions with CGI: ${phpVersions.join(', ')}`;
  });

  runTest('mutable runtime artifacts are untracked from git index', () => {
    const tracked = listTrackedBinaryFiles(projectRoot);
    const mutableRegexes = [
      /^resources\/binaries\/apache\/logs\//,
      /^resources\/binaries\/apache\/conf\/httpd\.devstack\.conf$/,
      /^resources\/binaries\/apache\/conf\/extra\/httpd-devstack-vhosts\.conf$/,
      /^resources\/binaries\/mysql\/data\//,
      /^resources\/binaries\/mysql\/tmp\//,
      /^resources\/binaries\/php\/[^/]+\/php\.ini$/,
      /^resources\/binaries\/php\/[^/]+\/php\.ini\.bak$/,
      /^resources\/binaries\/php\/[^/]+\/backups\//,
      /^resources\/binaries\/php\/[^/]+\/logs\//,
      /^resources\/binaries\/php\/[^/]+\/tmp\//,
      /^resources\/binaries\/php\/[^/]+\/sessions\//,
    ];

    const offenders = tracked.filter((filePath) =>
      mutableRegexes.some((pattern) => pattern.test(filePath))
    );
    assert(offenders.length === 0, `Tracked mutable artifacts remain: ${offenders.slice(0, 6).join(', ')}`);

    return 'No mutable runtime artifacts are tracked under resources/binaries';
  });

  runTest('first-run writable runtime directories are creatable outside resources', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-phase4-5-runtime-'));
    const previousCwd = process.cwd();

    try {
      process.chdir(tempRoot);

      const fakeResourcesDir = path.join(tempRoot, 'fake-resources');
      ensureDir(fakeResourcesDir);

      const runtimeRoot = getRuntimeRoot();
      const apacheRuntimeDir = getApacheRuntimeDir();
      const apacheLogDir = getApacheLogDir();
      const mysqlRuntimeDir = getMySQLRuntimeDir();
      const mysqlDataDir = getMySQLDataDir();
      const mysqlTmpDir = getMySQLTmpDir();
      const phpRuntimeDir = getPhpRuntimeDir('8.3.30');
      const phpIniPath = getPhpRuntimeIniPath('8.3.30');
      const apacheRuntimeConfigPath = getApacheRuntimeConfigPath();
      const apacheVhostPath = getApacheVhostConfigPath();

      const requiredDirs = [
        runtimeRoot,
        apacheRuntimeDir,
        apacheLogDir,
        mysqlRuntimeDir,
        mysqlDataDir,
        mysqlTmpDir,
        phpRuntimeDir,
        path.dirname(phpIniPath),
      ];

      for (const dirPath of requiredDirs) {
        ensureDir(dirPath);
        assert(fs.existsSync(dirPath), `Failed to create runtime dir: ${dirPath}`);
      }

      fs.writeFileSync(apacheRuntimeConfigPath, '# phase4_5_runtime_check\n', 'utf-8');
      fs.writeFileSync(apacheVhostPath, '# phase4_5_runtime_check\n', 'utf-8');
      fs.writeFileSync(phpIniPath, '; phase4_5_runtime_check\n', 'utf-8');

      assert(fs.existsSync(apacheRuntimeConfigPath), `Missing writable Apache runtime config: ${apacheRuntimeConfigPath}`);
      assert(fs.existsSync(apacheVhostPath), `Missing writable Apache vhost config: ${apacheVhostPath}`);
      assert(fs.existsSync(phpIniPath), `Missing writable runtime php.ini: ${phpIniPath}`);
      assert(
        !isSubPath(fakeResourcesDir, runtimeRoot),
        `Runtime root must not be under resources path: runtime=${runtimeRoot}, resources=${fakeResourcesDir}`
      );

      return `Runtime root=${runtimeRoot}`;
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Saved release check results to ${outputPath}`);

  if (results.some((result) => !result.success)) {
    process.exitCode = 1;
  }
}

main();
