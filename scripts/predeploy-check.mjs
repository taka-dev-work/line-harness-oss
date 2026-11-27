#!/usr/bin/env node
// Usage: node scripts/predeploy-check.mjs --client <client.json>   (read-only)
// Exits 0 only when `pnpm db:migrate:client` is safe to run on this client's D1.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClientConfig } from './lib/client-config.mjs';
import { clientWranglerRunner } from './lib/client-runner.mjs';
import { EXPECTED_SCHEMA_FILE, diffSchemas, remoteTableColumns, tableColumns } from './lib/schema-drift.mjs';
import { classifyD1, remoteAppliedMigrations, remoteTables } from './lib/predeploy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--client');
const clientPath = i > 0 ? process.argv[i + 1] : undefined;
if (!clientPath) {
  console.error('usage: predeploy-check.mjs --client <client.json>');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(clientPath, 'utf8'));
} catch (error) {
  console.error(`cannot read client config: ${error.code ?? error.message}`);
  process.exit(1);
}
const checked = validateClientConfig(config);
if (!checked.ok) {
  console.error(checked.errors.join('\n'));
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'predeploy-'));
let result;
try {
  const runner = clientWranglerRunner(config, root);
  console.error(runner.banner);
  const baseline = join(dir, 'baseline.db');
  execFileSync('sqlite3', [baseline], { input: readFileSync(join(root, EXPECTED_SCHEMA_FILE)) });
  const tables = remoteTables(runner.run);
  const applied = remoteAppliedMigrations(runner.run, tables);
  const diff = diffSchemas(tableColumns(baseline), remoteTableColumns(runner.run));
  result = classifyD1({ tables, applied, diff });
} catch (error) {
  result = { state: 'unknown', ok: false, message: `remote read failed: ${error.message}` };
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`state: ${result.state}`);
(result.ok ? console.log : console.error)(result.message);
process.exitCode = result.ok ? 0 : 1;
