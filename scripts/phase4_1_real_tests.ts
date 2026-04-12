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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-phase4-1-'));
  const processManager = new ProcessManager();
  const databaseService = new DatabaseService(processManager);

  const databaseName = `phase4_1_db_${Date.now()}`;
  const importSqlPath = path.join(tempRoot, `${databaseName}-import.sql`);
  const exportSqlPath = path.join(tempRoot, `${databaseName}-export.sql`);

  const importSql = [
    'DROP TABLE IF EXISTS phase4_1_records;',
    'CREATE TABLE phase4_1_records (',
    '  id INT NOT NULL AUTO_INCREMENT,',
    '  name VARCHAR(64) NOT NULL,',
    '  PRIMARY KEY (id)',
    ');',
    "INSERT INTO phase4_1_records (name) VALUES ('alpha'), ('beta');",
    '',
  ].join('\n');

  fs.writeFileSync(importSqlPath, importSql, 'utf-8');

  try {
    const startResult = await processManager.startService('mysql');
    if (!startResult.success) {
      throw new Error(startResult.error ?? startResult.message);
    }

    await runTest('Create database', async () => {
      const createResult = await databaseService.createDatabase(databaseName);
      assert(createResult.success, createResult.error ?? createResult.message);

      const listResult = await databaseService.listDatabases();
      assert(listResult.success, listResult.error ?? listResult.message);
      assert(
        listResult.databases.includes(databaseName),
        `Database ${databaseName} was not found after creation`
      );

      return `Created ${databaseName}`;
    });

    await runTest('Import SQL file', async () => {
      const importResult = await databaseService.importSqlFile(databaseName, importSqlPath);
      assert(importResult.success, importResult.error ?? importResult.message);
      return importResult.message;
    });

    await runTest('Export SQL file', async () => {
      const exportResult = await databaseService.exportDatabase(databaseName, exportSqlPath);
      assert(exportResult.success, exportResult.error ?? exportResult.message);
      assert(fs.existsSync(exportSqlPath), `Export file not found at ${exportSqlPath}`);

      const exportedContent = fs.readFileSync(exportSqlPath, 'utf-8');
      assert(
        exportedContent.includes('phase4_1_records'),
        'Exported SQL does not contain expected table name "phase4_1_records"'
      );

      return exportResult.filePath ?? exportSqlPath;
    });

    await runTest('Delete database', async () => {
      const deleteResult = await databaseService.deleteDatabase(databaseName);
      assert(deleteResult.success, deleteResult.error ?? deleteResult.message);

      const listResult = await databaseService.listDatabases();
      assert(listResult.success, listResult.error ?? listResult.message);
      assert(
        !listResult.databases.includes(databaseName),
        `Database ${databaseName} still exists after deletion`
      );

      return `Deleted ${databaseName}`;
    });
  } finally {
    await databaseService.deleteDatabase(databaseName);
    await processManager.stopAllServices();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const outputPath = path.join(projectRoot, 'phase4_1_test_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Saved test results to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
