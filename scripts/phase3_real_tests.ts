import fs from 'fs';
import os from 'os';
import path from 'path';
import { DomainService } from '../electron/services/domain.service';
import type { ServiceResult, ServiceState } from '../src/types';
import type { DomainRecord } from '../src/types/domain.types';
import type { PhpVersion } from '../src/types/php.types';

type TestResult = {
  name: string;
  success: boolean;
  details: string;
};

class MockProcessBridge {
  apacheStatus: ServiceState['status'] = 'stopped';
  restartShouldFail = false;
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
    if (this.restartShouldFail) {
      return {
        success: false,
        message: 'Restart failed',
        error: 'MOCK_RESTART_FAILURE',
      };
    }

    return { success: true, message: 'Restarted' };
  }
}

class MockPhpBridge {
  ensureCalls: string[] = [];

  async getAvailableVersions(): Promise<PhpVersion[]> {
    return [
      { version: '8.3.30', path: 'C:\\php\\8.3.30\\php.exe', installed: true, active: true, size: '30 MB' },
      { version: '8.2.0', path: '', installed: false, active: false, size: '29 MB' },
    ];
  }

  async ensurePhpCgiRunning(version: string): Promise<number> {
    this.ensureCalls.push(version);
    return 9830;
  }
}

const results: TestResult[] = [];

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-phase3-'));
  const hostsPath = path.join(tempRoot, 'hosts');
  const vhostPath = path.join(tempRoot, 'apache', 'conf', 'extra', 'httpd-devstack-vhosts.conf');
  const projectA = path.join(tempRoot, 'projects', 'alpha site');
  const projectB = path.join(tempRoot, 'projects', 'beta-site');
  let storedDomains: DomainRecord[] = [];

  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });
  fs.mkdirSync(path.dirname(vhostPath), { recursive: true });
  fs.writeFileSync(
    hostsPath,
    [
      '127.0.0.1 localhost',
      '::1 localhost',
      '# custom entry',
      '127.0.0.1 keepme.test',
      '',
    ].join('\r\n'),
    'utf-8'
  );

  const processBridge = new MockProcessBridge();
  const phpBridge = new MockPhpBridge();
  const domainService = new DomainService(processBridge, phpBridge, {
    hostsFilePath: hostsPath,
    apacheVhostConfigPath: vhostPath,
    storage: {
      getDomains: () => storedDomains,
      setDomains: (domains) => {
        storedDomains = [...domains];
      },
    },
  });

  try {
    await runTest('Create domain writes hosts and Apache vhost config', async () => {
      const result = await domainService.createDomain({
        hostname: 'alpha.test',
        projectPath: projectA,
        phpVersion: '8.3.30',
      });

      assert(result.success, result.error ?? result.message);
      assert(phpBridge.ensureCalls.includes('8.3.30'), 'PHP-CGI was not resolved for phpVersion');

      const hostsContent = fs.readFileSync(hostsPath, 'utf-8');
      assert(hostsContent.includes('DEVSTACK LOCAL DOMAINS START'), 'Hosts managed block was not added');
      assert(hostsContent.includes('127.0.0.1 alpha.test'), 'Hosts entry for alpha.test missing');

      const vhostContent = fs.readFileSync(vhostPath, 'utf-8');
      assert(vhostContent.includes('ServerName alpha.test'), 'Vhost ServerName missing for alpha.test');
      assert(vhostContent.includes('SetHandler "proxy:fcgi://127.0.0.1:9830"'), 'PHP FastCGI handler missing');
      assert(
        vhostContent.includes(`DocumentRoot "${projectA.replace(/\\/g, '/')}"`),
        'Vhost DocumentRoot was not normalized to Apache path format'
      );

      return 'hosts + vhost files generated with PHP mapping for alpha.test';
    });

    await runTest('Duplicate hostname is rejected', async () => {
      const result = await domainService.createDomain({
        hostname: 'ALPHA.TEST',
        projectPath: projectA,
      });

      assert(!result.success, 'Duplicate hostname was accepted');
      assert(
        (result.error ?? '').toLowerCase().includes('already configured'),
        `Unexpected duplicate error message: ${result.error ?? result.message}`
      );
      return result.error ?? result.message;
    });

    await runTest('Update domain rewrites files and restarts Apache when running', async () => {
      const [stored] = storedDomains;
      assert(stored, 'No stored domain found for update test');

      processBridge.apacheStatus = 'running';

      const result = await domainService.updateDomain(stored.id, {
        hostname: 'beta.test',
        projectPath: projectB,
        phpVersion: null,
      });

      assert(result.success, result.error ?? result.message);
      assert(processBridge.restartCalls > 0, 'Apache restart was not triggered for running service');

      const hostsContent = fs.readFileSync(hostsPath, 'utf-8');
      assert(hostsContent.includes('127.0.0.1 beta.test'), 'Updated hostname missing in hosts file');
      assert(!hostsContent.includes('127.0.0.1 alpha.test'), 'Old hostname still present in hosts file');

      const vhostContent = fs.readFileSync(vhostPath, 'utf-8');
      assert(vhostContent.includes('ServerName beta.test'), 'Updated vhost missing beta.test');
      assert(!vhostContent.includes('SetHandler "proxy:fcgi://127.0.0.1:9830"'), 'PHP handler should be removed after clearing phpVersion');

      return `Apache restart calls: ${processBridge.restartCalls}`;
    });

    await runTest('Delete domain removes managed hosts entries but preserves manual entries', async () => {
      const [stored] = storedDomains;
      assert(stored, 'No stored domain found for delete test');

      const result = await domainService.deleteDomain(stored.id);
      assert(result.success, result.error ?? result.message);

      const hostsContent = fs.readFileSync(hostsPath, 'utf-8');
      assert(!hostsContent.includes('DEVSTACK LOCAL DOMAINS START'), 'Hosts managed block still present');
      assert(hostsContent.includes('127.0.0.1 keepme.test'), 'Manual hosts entry should be preserved');
      assert(!hostsContent.includes('beta.test'), 'Deleted domain hostname still exists in hosts file');

      const vhostContent = fs.readFileSync(vhostPath, 'utf-8');
      assert(vhostContent.includes('# No domains configured.'), 'Vhost file did not reset to empty state');

      return 'Managed block removed while manual hosts entries remained intact';
    });

    await runTest('Domain create succeeds even if Apache restart fails', async () => {
      processBridge.apacheStatus = 'running';
      processBridge.restartShouldFail = true;

      const result = await domainService.createDomain({
        hostname: 'gamma.test',
        projectPath: projectB,
      });

      assert(result.success, result.error ?? result.message);
      assert(
        result.message.includes('Apache restart failed'),
        `Expected restart failure note in message, got: ${result.message}`
      );

      const hostsContent = fs.readFileSync(hostsPath, 'utf-8');
      assert(hostsContent.includes('127.0.0.1 gamma.test'), 'Domain should still be persisted when restart fails');

      return result.message;
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const outputPath = path.join(projectRoot, 'phase3_test_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Saved test results to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
