#!/usr/bin/env node
// Usage: node scripts/check-d1-schema-drift.mjs --client path/to/client.json
// Compares the remote D1 tables/columns with the frozen baseline (0000_baseline.sql). Read-only.
// Exits 1 when baseline tables or columns are missing remotely. Columns added by later
// migrations are not expected here: `db:migrate:client` adds them.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLUMNS_QUERY, EXPECTED_SCHEMA_FILE, columnsFromRows, tableColumns, diffSchemas } from './lib/schema-drift.mjs';
import { clientWranglerInvocation } from './lib/with-client.mjs';
import { renderWranglerToml } from './lib/render-wrangler.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientIndex = process.argv.indexOf('--client');
const clientPath = clientIndex > 0 ? process.argv[clientIndex + 1] : undefined;
if (!clientPath) {
  console.error('usage: check-d1-schema-drift.mjs --client <client.json>');
  process.exit(1);
}
let invocation;
try {
  const config = JSON.parse(readFileSync(clientPath, 'utf8'));
  invocation = clientWranglerInvocation(config, ['d1', 'execute', 'DB', '--remote', '--json', '--command', COLUMNS_QUERY]);
  writeFileSync(join(root, invocation.configPath), renderWranglerToml(config));
} catch (error) {
  console.error(error.code ? `cannot read client config: ${error.code}` : error.message);
  process.exit(1);
}
console.error(invocation.banner);

const dir = mkdtempSync(join(tmpdir(), 'schema-drift-'));
let expected;
try {
  const db = join(dir, 'expected.db');
  execFileSync('sqlite3', [db], { input: readFileSync(join(root, EXPECTED_SCHEMA_FILE)) });
  expected = tableColumns(db);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const raw = execFileSync('pnpm', invocation.argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const rows = JSON.parse(raw).flatMap((r) => r.results ?? []);
const diff = diffSchemas(expected, columnsFromRows(rows));

for (const t of diff.missingTables) console.log(`MISSING TABLE  ${t}`);
for (const c of diff.missingColumns) console.log(`MISSING COLUMN ${c}`);
for (const t of diff.extraTables) console.log(`extra table    ${t} (not in baseline; informational)`);
const failed = diff.missingTables.length + diff.missingColumns.length > 0;
console.log(failed ? 'DRIFT: remote schema is behind 0000_baseline.sql' : 'OK: remote schema has every table and column in 0000_baseline.sql');
process.exit(failed ? 1 : 0);
