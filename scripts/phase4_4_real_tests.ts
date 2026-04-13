import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProcessManager } from '../electron/services/process.manager';
import { DatabaseService } from '../electron/services/database.service';

type TestResult = {
  name: string;
  success: boolean;
  details: string;
};

type PrivateDatabaseService = {
  execFileCommand: (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>;
};

const results: TestResult[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-phase4-4-'));
  const processManager = new ProcessManager();
  const databaseService = new DatabaseService(processManager);

  const databaseName = `phase4_4_db_${Date.now()}`;
  const tableName = 'phase4_4_records';
  const importSqlPath = path.join(tempRoot, `${databaseName}-import.sql`);

  const importSql = [
    `DROP TABLE IF EXISTS ${tableName};`,
    `CREATE TABLE ${tableName} (`,
    '  id INT NOT NULL AUTO_INCREMENT,',
    '  label VARCHAR(64) NOT NULL,',
    '  note VARCHAR(255) NOT NULL,',
    '  PRIMARY KEY (id)',
    ');',
    `INSERT INTO ${tableName} (label, note) VALUES`,
    `  ('alpha', 'simple value'),`,
    `  ('beta', 'comma,value'),`,
    `  ('gamma', 'quote "value"'),`,
    `  ('delta', 'tab\\tvalue');`,
    '',
  ].join('\n');

  fs.writeFileSync(importSqlPath, importSql, 'utf-8');

  try {
    const startResult = await processManager.startService('mysql');
    if (!startResult.success) {
      throw new Error(startResult.error ?? startResult.message);
    }

    const createResult = await databaseService.createDatabase(databaseName);
    assert(createResult.success, createResult.error ?? createResult.message);

    const importResult = await databaseService.importSqlFile(databaseName, importSqlPath);
    assert(importResult.success, importResult.error ?? importResult.message);

    await runTest('Export table to CSV with sanitized filename', async () => {
      const requestedExportPath = path.join(tempRoot, 'phase4 4 table:*?export');
      const exportResult = await databaseService.exportTableToCsv(
        databaseName,
        tableName,
        requestedExportPath
      );

      assert(exportResult.success, exportResult.error ?? exportResult.message);
      assert(exportResult.filePath, 'CSV export did not return filePath');
      assert(fs.existsSync(exportResult.filePath), `CSV export file not found: ${exportResult.filePath}`);

      const outputFileName = path.basename(exportResult.filePath);
      const stem = path.basename(outputFileName, '.csv');
      assert(outputFileName.endsWith('.csv'), `Export filename is not .csv: ${outputFileName}`);
      assert(!/\s/.test(stem), `CSV filename stem should not contain spaces: ${stem}`);
      assert(!/[<>:"/\\|?*]/.test(stem), `CSV filename stem contains unsafe characters: ${stem}`);

      const csvContent = fs.readFileSync(exportResult.filePath, 'utf-8');
      assert(csvContent.includes('"id","label","note"'), 'CSV is missing header row');
      assert(csvContent.includes('"comma,value"'), 'CSV is missing comma-delimited value row');
      assert(csvContent.includes('"quote ""value"""'), 'CSV did not escape quotes correctly');

      return exportResult.filePath;
    });

    await runTest('Write queries report affected row counts', async () => {
      const updateResult = await databaseService.executeQuery(
        databaseName,
        `UPDATE ${tableName} SET label = 'epsilon' WHERE id = 1`,
        true
      );
      assert(updateResult.success, updateResult.error ?? updateResult.message);
      assert(updateResult.queryType === 'update', `Expected update queryType, got ${updateResult.queryType}`);
      assert(updateResult.affectedRows === 1, `Expected UPDATE affectedRows=1, got ${updateResult.affectedRows}`);

      const deleteResult = await databaseService.executeQuery(
        databaseName,
        `DELETE FROM ${tableName} WHERE id = 2`,
        true
      );
      assert(deleteResult.success, deleteResult.error ?? deleteResult.message);
      assert(deleteResult.queryType === 'delete', `Expected delete queryType, got ${deleteResult.queryType}`);
      assert(deleteResult.affectedRows === 1, `Expected DELETE affectedRows=1, got ${deleteResult.affectedRows}`);

      return `UPDATE affected ${updateResult.affectedRows}, DELETE affected ${deleteResult.affectedRows}`;
    });

    await runTest('Overlapping row fetch cancels stale request', async () => {
      const servicePrivate = databaseService as unknown as PrivateDatabaseService;
      const originalExec = servicePrivate.execFileCommand.bind(databaseService);

      let delayFirstExecCall = true;
      servicePrivate.execFileCommand = async (...args: unknown[]) => {
        if (delayFirstExecCall) {
          delayFirstExecCall = false;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return originalExec(...args);
      };

      try {
        const firstPromise = databaseService.getTableRows(databaseName, tableName, 1, 25);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const secondPromise = databaseService.getTableRows(databaseName, tableName, 2, 25);

        const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
        assert(!firstResult.success, 'Expected first row fetch to be cancelled');
        assert(
          firstResult.error === 'ROW_FETCH_CANCELLED',
          `Unexpected first row fetch error: ${firstResult.error ?? firstResult.message}`
        );
        assert(secondResult.success, secondResult.error ?? secondResult.message);

        return `First request cancelled; second request loaded ${secondResult.rows.length} rows`;
      } finally {
        servicePrivate.execFileCommand = originalExec;
      }
    });

    await runTest('Long-running SQL is timeout bounded', async () => {
      const timeoutResult = await databaseService.executeQuery(
        databaseName,
        'SELECT SLEEP(20) AS sleep_seconds'
      );
      assert(!timeoutResult.success, 'Expected timeout query to fail');

      const details = (timeoutResult.error ?? timeoutResult.message).toLowerCase();
      const timeoutLike =
        details.includes('timed out') ||
        details.includes('maximum statement execution time') ||
        details.includes('query execution was interrupted');

      assert(
        timeoutLike,
        `Expected timeout-style error message, got: ${timeoutResult.error ?? timeoutResult.message}`
      );
      return timeoutResult.error ?? timeoutResult.message;
    });
  } finally {
    await databaseService.deleteDatabase(databaseName);
    await processManager.stopAllServices();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const outputPath = path.join(projectRoot, 'phase4_4_test_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Saved test results to ${outputPath}`);

  const failedCount = results.filter((result) => !result.success).length;
  if (failedCount > 0) {
    throw new Error(`Phase 4.4 real tests failed (${failedCount} failed test(s))`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
