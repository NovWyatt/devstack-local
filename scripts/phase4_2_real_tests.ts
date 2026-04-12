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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-phase4-2-'));
  const processManager = new ProcessManager();
  const databaseService = new DatabaseService(processManager);

  const databaseName = `phase4_2_db_${Date.now()}`;
  const tableName = 'phase4_2_records';
  const importSqlPath = path.join(tempRoot, `${databaseName}-import.sql`);

  const importSql = [
    `DROP TABLE IF EXISTS ${tableName};`,
    `CREATE TABLE ${tableName} (`,
    '  id INT NOT NULL AUTO_INCREMENT,',
    '  label VARCHAR(64) NOT NULL,',
    '  PRIMARY KEY (id)',
    ');',
    `INSERT INTO ${tableName} (label) VALUES ('alpha'), ('beta'), ('gamma'), ('delta'), ('epsilon');`,
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

    await runTest('List tables', async () => {
      const tablesResult = await databaseService.listTables(databaseName);
      assert(tablesResult.success, tablesResult.error ?? tablesResult.message);
      assert(
        tablesResult.tables.includes(tableName),
        `Expected table ${tableName} not found in ${databaseName}`
      );

      return `${tablesResult.tables.length} tables loaded from ${databaseName}`;
    });

    await runTest('Load table schema', async () => {
      const schemaResult = await databaseService.getTableSchema(databaseName, tableName);
      assert(schemaResult.success, schemaResult.error ?? schemaResult.message);
      assert(schemaResult.columns.length >= 2, 'Schema should include at least id and label columns');

      const idColumn = schemaResult.columns.find((column) => column.field === 'id');
      const labelColumn = schemaResult.columns.find((column) => column.field === 'label');
      assert(idColumn, 'Schema is missing id column');
      assert(labelColumn, 'Schema is missing label column');

      return `Schema columns: ${schemaResult.columns.map((column) => column.field).join(', ')}`;
    });

    await runTest('Load paged table rows', async () => {
      const page1 = await databaseService.getTableRows(databaseName, tableName, 1, 2);
      assert(page1.success, page1.error ?? page1.message);
      assert(page1.rows.length === 2, `Expected 2 rows on page 1, got ${page1.rows.length}`);
      assert(page1.hasMore, 'Expected hasMore=true on page 1');

      const page2 = await databaseService.getTableRows(databaseName, tableName, 2, 2);
      assert(page2.success, page2.error ?? page2.message);
      assert(page2.rows.length === 2, `Expected 2 rows on page 2, got ${page2.rows.length}`);
      assert(page2.hasMore, 'Expected hasMore=true on page 2');

      const page3 = await databaseService.getTableRows(databaseName, tableName, 3, 2);
      assert(page3.success, page3.error ?? page3.message);
      assert(page3.rows.length === 1, `Expected 1 row on page 3, got ${page3.rows.length}`);
      assert(!page3.hasMore, 'Expected hasMore=false on final page');

      const allRows = [...page1.rows, ...page2.rows, ...page3.rows];
      const labels = allRows
        .map((row) => row.label)
        .filter((value): value is string => typeof value === 'string')
        .sort((a, b) => a.localeCompare(b));

      assert(
        JSON.stringify(labels) === JSON.stringify(['alpha', 'beta', 'delta', 'epsilon', 'gamma']),
        `Unexpected paged labels: ${labels.join(', ')}`
      );

      return `Pagination verified across pages (2 + 2 + 1 rows)`;
    });
  } finally {
    await databaseService.deleteDatabase(databaseName);
    await processManager.stopAllServices();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const outputPath = path.join(projectRoot, 'phase4_2_test_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Saved test results to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
