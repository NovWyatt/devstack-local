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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-phase4-3-'));
  const processManager = new ProcessManager();
  const databaseService = new DatabaseService(processManager);

  const databaseName = `phase4_3_db_${Date.now()}`;
  const tableName = 'phase4_3_records';
  const importSqlPath = path.join(tempRoot, `${databaseName}-import.sql`);

  const importSql = [
    `DROP TABLE IF EXISTS ${tableName};`,
    `CREATE TABLE ${tableName} (`,
    '  id INT NOT NULL AUTO_INCREMENT,',
    '  label VARCHAR(64) NOT NULL,',
    '  PRIMARY KEY (id)',
    ');',
    `INSERT INTO ${tableName} (label) VALUES ('alpha'), ('beta'), ('gamma');`,
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

    await runTest('Select query passes', async () => {
      const result = await databaseService.executeQuery(
        databaseName,
        `SELECT id, label FROM ${tableName} ORDER BY id`
      );
      assert(result.success, result.error ?? result.message);
      assert(result.queryType === 'select', `Expected queryType=select, got ${result.queryType}`);
      assert(result.rows.length === 3, `Expected 3 rows, got ${result.rows.length}`);
      return `Returned ${result.rows.length} rows`;
    });

    await runTest('Invalid SQL fails cleanly', async () => {
      const result = await databaseService.executeQuery(databaseName, `SELEC * FROM ${tableName}`);
      assert(!result.success, 'Invalid SQL unexpectedly succeeded');
      assert(!!result.error, 'Invalid SQL did not return an error message');
      return result.error ?? result.message;
    });

    await runTest('Dangerous query is blocked', async () => {
      const result = await databaseService.executeQuery(databaseName, `DROP TABLE ${tableName}`);
      assert(!result.success, 'Dangerous query unexpectedly succeeded');
      const detail = result.error ?? result.message;
      assert(detail.toLowerCase().includes('blocked'), `Expected blocked error, got: ${detail}`);
      return detail;
    });
  } finally {
    await databaseService.deleteDatabase(databaseName);
    await processManager.stopAllServices();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const outputPath = path.join(projectRoot, 'phase4_3_test_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Saved test results to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
