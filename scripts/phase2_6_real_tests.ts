import fs from 'fs';
import path from 'path';
import net from 'net';
import treeKill from 'tree-kill';
import { ProcessManager } from '../electron/services/process.manager';
import { PhpService } from '../electron/services/php.service';
import { isPortListening } from '../electron/utils/port.util';
import { isHttpResponsive } from '../electron/utils/runtime.validation';

type TestResult = {
  name: string;
  success: boolean;
  details: string;
};

const results: TestResult[] = [];

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs: number = 100
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await condition()) {
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
}

async function killPid(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    treeKill(pid, 'SIGKILL', () => resolve());
  });
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

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const binariesRoot = path.join(projectRoot, 'resources', 'binaries');
  const apacheRoot = path.join(binariesRoot, 'apache');
  const phpVersion = '8.3.30';
  const phpProcessName = `php-cgi-${phpVersion}`;
  const expectedPhpPort = 9803;

  const processManager = new ProcessManager();
  const phpService = new PhpService();
  phpService.setProcessManager(processManager);

  let apachePid: number | undefined;
  let mysqlPid: number | undefined;
  let phpPid: number | undefined;

  try {
    await runTest('Apache starts and responds on localhost', async () => {
      const result = await processManager.startService('apache');
      if (!result.success) {
        throw new Error(result.error ?? result.message);
      }

      const responsive = await isHttpResponsive(80, '127.0.0.1', '/', 1000);
      if (!responsive) {
        throw new Error('Apache process started but HTTP endpoint did not respond');
      }

      apachePid = processManager.getProcessPid('apache');
      if (!apachePid) {
        throw new Error('Apache PID was not recorded');
      }

      return `PID ${apachePid}, HTTP probe succeeded on http://localhost:80`;
    });

    await runTest('MySQL starts and accepts TCP connections', async () => {
      const result = await processManager.startService('mysql');
      if (!result.success) {
        throw new Error(result.error ?? result.message);
      }

      const listening = await isPortListening(3306, '127.0.0.1', 1000);
      if (!listening) {
        throw new Error('MySQL process started but port 3306 is not accepting TCP connections');
      }

      mysqlPid = processManager.getProcessPid('mysql');
      if (!mysqlPid) {
        throw new Error('MySQL PID was not recorded');
      }

      return `PID ${mysqlPid}, TCP probe succeeded on 127.0.0.1:3306`;
    });

    await runTest('PHP-CGI starts and listens on runtime port', async () => {
      await phpService.startPhpCgi(phpVersion);

      const listening = await isPortListening(expectedPhpPort, '127.0.0.1', 1000);
      if (!listening) {
        throw new Error(`PHP-CGI expected port ${expectedPhpPort} is not listening`);
      }

      phpPid = processManager.getProcessPid(phpProcessName);
      if (!phpPid) {
        throw new Error('PHP-CGI PID was not recorded');
      }

      return `PID ${phpPid}, TCP probe succeeded on 127.0.0.1:${expectedPhpPort}`;
    });

    await runTest('Crash auto-restart enforces max 3 attempts', async () => {
      // Ensure process is running before crash-loop test.
      if (!processManager.isRunning(phpProcessName)) {
        await phpService.startPhpCgi(phpVersion);
      }

      const observedRestartPids: number[] = [];
      let currentPid = processManager.getProcessPid(phpProcessName);
      if (!currentPid) {
        throw new Error('Unable to read initial PHP-CGI PID for crash-loop test');
      }

      for (let crashIndex = 1; crashIndex <= 4; crashIndex++) {
        await killPid(currentPid);

        const stopped = await waitFor(() => !processManager.isRunning(phpProcessName), 3000, 100);
        if (!stopped) {
          throw new Error(`PHP-CGI did not stop after crash injection #${crashIndex}`);
        }

        const restartExpected = crashIndex <= 3;
        const restarted = await waitFor(() => {
          const pid = processManager.getProcessPid(phpProcessName);
          return !!pid && pid !== currentPid;
        }, 8000, 100);

        if (restartExpected && !restarted) {
          throw new Error(`Expected auto-restart after crash #${crashIndex}, but none occurred`);
        }

        if (!restartExpected && restarted) {
          throw new Error('Process restarted after exceeding max restart attempts');
        }

        if (restartExpected) {
          currentPid = processManager.getProcessPid(phpProcessName)!;
          observedRestartPids.push(currentPid);
        }
      }

      return `Observed ${observedRestartPids.length} restarts with unique PIDs: ${observedRestartPids.join(', ')}`;
    });

    await runTest('Stop services leaves no managed processes running', async () => {
      await phpService.stopPhpCgi(phpVersion);
      await processManager.stopService('apache');
      await processManager.stopService('mysql');

      const trackedStopped =
        !processManager.isRunning('apache') &&
        !processManager.isRunning('mysql') &&
        !processManager.isRunning(phpProcessName);

      if (!trackedStopped) {
        throw new Error('One or more managed processes are still marked running after stop');
      }

      const pids = [apachePid, mysqlPid, phpPid].filter((pid): pid is number => !!pid);
      for (const pid of pids) {
        try {
          process.kill(pid, 0);
          throw new Error(`PID ${pid} still exists after stop sequence`);
        } catch (error) {
          const maybeError = error as NodeJS.ErrnoException;
          if (maybeError?.code === 'ESRCH') {
            continue;
          }
          throw error;
        }
      }

      return 'All tracked service processes stopped and PIDs are gone';
    });

    await runTest('Port conflict returns clear MySQL error', async () => {
      const blocker = net.createServer();
      await new Promise<void>((resolve, reject) => {
        blocker.once('error', reject);
        blocker.listen(3306, '127.0.0.1', () => resolve());
      });

      try {
        const result = await processManager.startService('mysql');
        if (result.success) {
          throw new Error('MySQL unexpectedly started despite an active port conflict');
        }

        const message = `${result.message} ${result.error ?? ''}`;
        if (!message.includes('Port 3306')) {
          throw new Error(`Conflict error message missing port detail: ${message}`);
        }

        return message.trim();
      } finally {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
      }
    });

    await runTest('Missing binary returns clear Apache error', async () => {
      const httpdPath = path.join(apacheRoot, 'bin', 'httpd.exe');
      const backupPath = `${httpdPath}.phase26.bak`;

      if (!fs.existsSync(httpdPath)) {
        throw new Error('httpd.exe is missing before test setup');
      }

      fs.renameSync(httpdPath, backupPath);

      try {
        const result = await processManager.startService('apache');
        if (result.success) {
          throw new Error('Apache unexpectedly started with missing binary');
        }

        const message = `${result.message} ${result.error ?? ''}`;
        if (!message.toLowerCase().includes('not found')) {
          throw new Error(`Missing-binary error message is not clear: ${message}`);
        }

        return message.trim();
      } finally {
        if (fs.existsSync(backupPath)) {
          fs.renameSync(backupPath, httpdPath);
        }
      }
    });
  } finally {
    await processManager.stopAllServices();
  }

  const outputPath = path.join(projectRoot, 'phase2_6_test_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Saved test results to ${outputPath}`);
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
