import fs from 'fs';
import os from 'os';
import path from 'path';
import { DomainService } from '../electron/services/domain.service';
import type { ServiceResult, ServiceState } from '../src/types';
import type { DomainOperationResult, DomainRecord } from '../src/types/domain.types';
import type { PhpVersion } from '../src/types/php.types';

type TestResult = {
  name: string;
  success: boolean;
  details: string;
};

interface FixtureOptions {
  apacheStatus?: ServiceState['status'];
  restartError?: string;
  restartDelayMs?: number;
  initialDomains?: DomainRecord[];
  hostsContent?: string;
  apacheConfigValidator?: () => Promise<void>;
}

interface Fixture {
  tempRoot: string;
  hostsPath: string;
  vhostPath: string;
  projectA: string;
  projectB: string;
  processBridge: MockProcessBridge;
  getDomains: () => DomainRecord[];
  domainService: DomainService;
  cleanup: () => void;
}

const results: TestResult[] = [];
const HOSTS_BLOCK_START = '# DEVSTACK LOCAL DOMAINS START';
const HOSTS_BLOCK_END = '# DEVSTACK LOCAL DOMAINS END';

class MockProcessBridge {
  apacheStatus: ServiceState['status'] = 'stopped';
  restartError: string | null = null;
  restartDelayMs = 0;
  restartCalls = 0;
  logs: Array<{ level: string; message: string }> = [];

  broadcastLog(level: string, message: string): void {
    this.logs.push({ level, message });
  }

  getServiceStatus(_service: 'apache'): ServiceState {
    return {
      status: this.apacheStatus,
      version: '2.4.62',
      port: 80,
    };
  }

  async restartService(_service: 'apache'): Promise<ServiceResult> {
    this.restartCalls += 1;
    if (this.restartDelayMs > 0) {
      await sleep(this.restartDelayMs);
    }

    if (this.restartError) {
      return {
        success: false,
        message: 'Restart failed',
        error: this.restartError,
      };
    }

    return {
      success: true,
      message: 'Restart succeeded',
    };
  }
}

class MockPhpBridge {
  async getAvailableVersions(): Promise<PhpVersion[]> {
    return [
      { version: '8.3.30', path: 'C:\\php\\8.3.30\\php.exe', installed: true, active: true, size: '30 MB' },
      { version: '8.5.1', path: 'C:\\php\\8.5.1\\php.exe', installed: true, active: false, size: '32 MB' },
    ];
  }

  async ensurePhpCgiRunning(version: string): Promise<number> {
    if (version === '8.5.1') return 9851;
    return 9830;
  }
}

function buildManagedHostsBlock(hostnames: string[]): string {
  return [HOSTS_BLOCK_START, ...hostnames.map((hostname) => `127.0.0.1 ${hostname}`), HOSTS_BLOCK_END].join('\r\n');
}

function createDomainRecord(id: string, hostname: string, projectPath: string): DomainRecord {
  const now = new Date().toISOString();
  return {
    id,
    hostname,
    projectPath,
    phpVersion: null,
    phpPort: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createFixture(options: FixtureOptions = {}): Fixture {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-phase3-1-'));
  const hostsPath = path.join(tempRoot, 'hosts');
  const vhostPath = path.join(tempRoot, 'apache', 'conf', 'extra', 'httpd-devstack-vhosts.conf');
  const projectA = path.join(tempRoot, 'projects', 'alpha');
  const projectB = path.join(tempRoot, 'projects', 'beta');

  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });
  fs.mkdirSync(path.dirname(vhostPath), { recursive: true });

  const defaultHosts = ['127.0.0.1 localhost', '::1 localhost', '127.0.0.1 keep.manual.test', ''].join('\r\n');
  fs.writeFileSync(hostsPath, options.hostsContent ?? defaultHosts, 'utf-8');

  const processBridge = new MockProcessBridge();
  processBridge.apacheStatus = options.apacheStatus ?? 'stopped';
  processBridge.restartError = options.restartError ?? null;
  processBridge.restartDelayMs = options.restartDelayMs ?? 0;

  let storedDomains = [...(options.initialDomains ?? [])];
  const phpBridge = new MockPhpBridge();
  const domainService = new DomainService(processBridge, phpBridge, {
    hostsFilePath: hostsPath,
    apacheVhostConfigPath: vhostPath,
    apacheConfigValidator: options.apacheConfigValidator,
    storage: {
      getDomains: () => storedDomains,
      setDomains: (domains) => {
        storedDomains = [...domains];
      },
    },
  });

  return {
    tempRoot,
    hostsPath,
    vhostPath,
    projectA,
    projectB,
    processBridge,
    getDomains: () => [...storedDomains],
    domainService,
    cleanup: () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (index <= content.length) {
    const found = content.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function runTest(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const details = await fn();
    results.push({ name, success: true, details });
    console.log(`[PASS] ${name}: ${details}`);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    results.push({ name, success: false, details });
    console.error(`[FAIL] ${name}: ${details}`);
  }
}

async function expectFailure(result: DomainOperationResult, context: string): Promise<void> {
  if (result.success) {
    throw new Error(`${context}: expected failure but succeeded`);
  }
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();

  await runTest('rollback works on apache fail', async () => {
    const fixture = createFixture({
      apacheStatus: 'running',
      restartError: 'MOCK_RESTART_FAILURE',
      apacheConfigValidator: async () => undefined,
      initialDomains: [createDomainRecord('domain-existing', 'existing.test', path.join(os.tmpdir(), 'existing-project'))],
      hostsContent: [
        '127.0.0.1 localhost',
        '::1 localhost',
        '127.0.0.1 keep.manual.test',
        '',
        buildManagedHostsBlock(['existing.test']),
        '',
      ].join('\r\n'),
    });

    try {
      const beforeHosts = fs.readFileSync(fixture.hostsPath, 'utf-8');
      const beforeVhost = fs.readFileSync(fixture.vhostPath, 'utf-8');
      const beforeDomains = fixture.getDomains();

      const result = await fixture.domainService.createDomain({
        hostname: 'newdomain.test',
        projectPath: fixture.projectA,
      });

      await expectFailure(result, 'apache restart rollback');
      assert(
        (result.error ?? '').includes('All domain changes were rolled back'),
        `Missing rollback message: ${result.error ?? result.message}`
      );

      const afterHosts = fs.readFileSync(fixture.hostsPath, 'utf-8');
      const afterVhost = fs.readFileSync(fixture.vhostPath, 'utf-8');
      const afterDomains = fixture.getDomains();

      assert(afterHosts === beforeHosts, 'Hosts file was not rolled back');
      assert(afterVhost === beforeVhost, 'Vhost file was not rolled back');
      assert(
        JSON.stringify(afterDomains) === JSON.stringify(beforeDomains),
        'Domain storage state was not rolled back'
      );

      return `restart calls: ${fixture.processBridge.restartCalls}`;
    } finally {
      fixture.cleanup();
    }
  });

  await runTest('mutex prevents race corruption', async () => {
    const fixture = createFixture();

    try {
      const createTasks = Array.from({ length: 25 }, (_, index) => {
        const hostname = `race-${index + 1}.test`;
        const projectPath = index % 2 === 0 ? fixture.projectA : fixture.projectB;
        return fixture.domainService.createDomain({ hostname, projectPath });
      });

      const resultsList = await Promise.all(createTasks);
      const failures = resultsList.filter((item) => !item.success);
      assert(failures.length === 0, `Unexpected failures under concurrent create: ${failures.length}`);

      const domains = fixture.getDomains();
      assert(domains.length === 25, `Expected 25 domains, got ${domains.length}`);

      const hostsContent = fs.readFileSync(fixture.hostsPath, 'utf-8');
      assert(
        countOccurrences(hostsContent, HOSTS_BLOCK_START) === 1 &&
          countOccurrences(hostsContent, HOSTS_BLOCK_END) === 1,
        'Hosts managed block markers were corrupted'
      );

      for (let i = 1; i <= 25; i++) {
        assert(hostsContent.includes(`127.0.0.1 race-${i}.test`), `Missing hosts entry for race-${i}.test`);
      }

      const vhostContent = fs.readFileSync(fixture.vhostPath, 'utf-8');
      for (let i = 1; i <= 25; i++) {
        assert(vhostContent.includes(`ServerName race-${i}.test`), `Missing vhost entry for race-${i}.test`);
      }

      return `domains persisted: ${domains.length}`;
    } finally {
      fixture.cleanup();
    }
  });

  await runTest('invalid path rejected', async () => {
    const fixture = createFixture();

    try {
      const filePath = path.join(fixture.tempRoot, 'not-a-directory.txt');
      fs.writeFileSync(filePath, 'plain file', 'utf-8');

      const missingPathResult = await fixture.domainService.createDomain({
        hostname: 'missing-path.test',
        projectPath: path.join(fixture.tempRoot, 'missing-dir'),
      });
      await expectFailure(missingPathResult, 'missing path validation');
      assert(
        (missingPathResult.error ?? '').includes('does not exist'),
        `Unexpected missing-path validation message: ${missingPathResult.error ?? missingPathResult.message}`
      );

      const filePathResult = await fixture.domainService.createDomain({
        hostname: 'file-path.test',
        projectPath: filePath,
      });
      await expectFailure(filePathResult, 'file path validation');
      assert(
        (filePathResult.error ?? '').includes('not a directory'),
        `Unexpected file-path validation message: ${filePathResult.error ?? filePathResult.message}`
      );

      assert(fixture.getDomains().length === 0, 'Invalid paths should not persist domains');
      return 'missing and non-directory project paths rejected';
    } finally {
      fixture.cleanup();
    }
  });

  await runTest('invalid hostname rejected', async () => {
    const fixture = createFixture();

    try {
      const invalidHostnames = ['localhost', '127.0.0.1', 'example.com', 'bad_host.test'];
      for (const hostname of invalidHostnames) {
        const result = await fixture.domainService.createDomain({
          hostname,
          projectPath: fixture.projectA,
        });
        await expectFailure(result, `invalid hostname ${hostname}`);
      }

      const allowedHostnames = ['alpha.local', 'beta.test', 'api.dev.local'];
      for (const hostname of allowedHostnames) {
        const result = await fixture.domainService.createDomain({
          hostname,
          projectPath: fixture.projectA,
        });
        assert(result.success, `Expected allowed hostname "${hostname}" to pass`);
      }

      return `invalid rejected: ${invalidHostnames.length}, allowed accepted: ${allowedHostnames.length}`;
    } finally {
      fixture.cleanup();
    }
  });

  await runTest('syntax fail rollback works', async () => {
    const syntaxError =
      'C:/apache/conf/extra/httpd-devstack-vhosts.conf: Syntax error on line 19, invalid command "BrokenDirective"';

    const fixture = createFixture({
      apacheStatus: 'running',
      apacheConfigValidator: async () => {
        throw new Error(syntaxError);
      },
    });

    try {
      const beforeHosts = fs.readFileSync(fixture.hostsPath, 'utf-8');
      const beforeVhost = fs.readFileSync(fixture.vhostPath, 'utf-8');

      const result = await fixture.domainService.createDomain({
        hostname: 'syntax-fail.test',
        projectPath: fixture.projectA,
      });

      await expectFailure(result, 'syntax validation rollback');
      assert(
        (result.error ?? '').includes(syntaxError),
        `Syntax error was not surfaced to UI: ${result.error ?? result.message}`
      );
      assert(fixture.processBridge.restartCalls === 0, 'Restart should not run when syntax check fails');

      const afterHosts = fs.readFileSync(fixture.hostsPath, 'utf-8');
      const afterVhost = fs.readFileSync(fixture.vhostPath, 'utf-8');
      assert(afterHosts === beforeHosts, 'Hosts file did not roll back after syntax failure');
      assert(afterVhost === beforeVhost, 'Vhost file did not roll back after syntax failure');
      assert(fixture.getDomains().length === 0, 'Domain storage should remain unchanged after syntax failure');

      return 'syntax error surfaced and full rollback verified';
    } finally {
      fixture.cleanup();
    }
  });

  await runTest('managed block safe', async () => {
    const oldDomain = createDomainRecord('domain-old', 'old.test', path.join(os.tmpdir(), 'legacy-project'));

    const fixture = createFixture({
      initialDomains: [oldDomain],
      hostsContent: [
        '127.0.0.1 localhost',
        '# keep this custom line',
        '127.0.0.1 custom.keep.test',
        '',
        buildManagedHostsBlock(['old.test']),
        '',
      ].join('\r\n'),
    });

    try {
      const updateResult = await fixture.domainService.updateDomain(oldDomain.id, {
        hostname: 'renamed.test',
        projectPath: fixture.projectA,
      });
      assert(updateResult.success, updateResult.error ?? updateResult.message);

      const deleteResult = await fixture.domainService.deleteDomain(oldDomain.id);
      assert(deleteResult.success, deleteResult.error ?? deleteResult.message);

      const hostsContent = fs.readFileSync(fixture.hostsPath, 'utf-8');
      assert(hostsContent.includes('# keep this custom line'), 'Custom manual hosts lines were lost');
      assert(hostsContent.includes('127.0.0.1 custom.keep.test'), 'Manual hosts entry was lost');
      assert(
        countOccurrences(hostsContent, HOSTS_BLOCK_START) === 0 &&
          countOccurrences(hostsContent, HOSTS_BLOCK_END) === 0,
        'Managed hosts block markers should be removed after deleting last domain'
      );
      assert(!hostsContent.includes('old.test'), 'Old managed hostname was not removed');
      assert(!hostsContent.includes('renamed.test'), 'Deleted managed hostname still present');

      return 'manual entries preserved and managed block remained isolated';
    } finally {
      fixture.cleanup();
    }
  });

  const outputPath = path.join(projectRoot, 'phase3_1_test_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Saved test results to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
