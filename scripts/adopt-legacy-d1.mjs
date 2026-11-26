#!/usr/bin/env node
// Brings a D1 that predates tracked migrations up to 0000_baseline.sql and records
// the baseline in d1_migrations, so `pnpm db:migrate:client` can continue from 0001.
//
//   dry run (default, read-only):
//     node scripts/adopt-legacy-d1.mjs --client <client.json> --out <file.sql>
//   apply (writes to the client's D1):
//     ... --apply --export-file <full d1 export> --bookmark <time-travel bookmark> --confirm <d1DatabaseName>
//   rehearsal against a local D1:   add --local [--persist-to <dir>]
//
// The SQL is generated from the current drift, so after a partial failure the
// same command can simply be run again. See docs/runbooks/client-0-adoption.md.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClientConfig } from './lib/client-config.mjs';
import { clientWranglerRunner } from './lib/client-runner.mjs';
import { EXPECTED_SCHEMA_FILE, diffSchemas, parseWranglerJson, remoteQueryArgs, remoteTableColumns, tableColumns } from './lib/schema-drift.mjs';
import { adoptionStatements, isAdopted } from './lib/adopt-legacy-d1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: adopt-legacy-d1.mjs --client <client.json> --out <file.sql> [--apply --export-file <path> --bookmark <id> --confirm <d1DatabaseName>] [--local [--persist-to <dir>]]';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const clientPath = value('--client');
const out = value('--out');
if (!clientPath || !out) fail(USAGE);
if (value('--persist-to') && !flag('--local')) fail('--persist-to requires --local');

let config;
try {
  config = JSON.parse(readFileSync(clientPath, 'utf8'));
} catch (error) {
  fail(`cannot read client config: ${error.code ?? error.message}`);
}
const checked = validateClientConfig(config);
if (!checked.ok) fail(checked.errors.join('\n'));

const apply = flag('--apply');
if (apply) {
  const exportFile = value('--export-file');
  if (!exportFile) fail('--apply requires --export-file <full d1 export taken just before this run>');
  if (!existsSync(exportFile) || statSync(exportFile).size === 0) fail(`--export-file is missing or empty: ${exportFile}`);
  if (!value('--bookmark')) fail('--apply requires --bookmark <time-travel bookmark recorded just before this run>');
  if (value('--confirm') !== config.d1DatabaseName) fail(`--confirm must equal the d1 database name (${config.d1DatabaseName})`);
}

const runner = clientWranglerRunner(config, root, { local: flag('--local'), persistTo: value('--persist-to') });
console.error(runner.banner);

function appliedMigrations() {
  const tables = parseWranglerJson(
    runner.run(remoteQueryArgs("SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'")),
  ).flatMap((r) => r.results ?? []);
  if (tables.length === 0) return [];
  return parseWranglerJson(runner.run(remoteQueryArgs('SELECT name FROM d1_migrations ORDER BY id')))
    .flatMap((r) => r.results ?? [])
    .map((r) => r.name);
}

const dir = mkdtempSync(join(tmpdir(), 'adopt-'));
try {
  const baseline = join(dir, 'baseline.db');
  execFileSync('sqlite3', [baseline], { input: readFileSync(join(root, EXPECTED_SCHEMA_FILE)) });
  const expected = tableColumns(baseline);
  const diffNow = () => diffSchemas(expected, remoteTableColumns(runner.run));

  let applied;
  let diff;
  try {
    applied = appliedMigrations();
    if (isAdopted(applied)) fail('already adopted: d1_migrations has 0000_baseline.sql — use pnpm db:migrate:client');
    diff = diffNow();
  } catch (error) {
    fail(`remote read failed: ${error.message}`);
  }

  const statements = adoptionStatements(baseline, diff);
  const columns = diff.missingColumns.filter((c) => !diff.missingTables.includes(c.split('.')[0])).length;
  const indexes = statements.filter((s) => /^CREATE (UNIQUE )?INDEX/.test(s)).length;
  writeFileSync(
    out,
    [
      `-- adoption of ${config.d1DatabaseName} onto 0000_baseline.sql (generated ${new Date().toISOString()})`,
      `-- missing tables: ${diff.missingTables.join(', ') || 'none'}`,
      `-- missing columns: ${diff.missingColumns.join(', ') || 'none'}`,
      ...statements.map((s) => `${s};`),
      '',
    ].join('\n'),
  );
  console.log(`${diff.missingTables.length} tables, ${columns} columns, ${indexes} indexes (IF NOT EXISTS), then record 0000_baseline.sql`);
  console.log(`SQL written to ${resolve(out)}`);
  if (applied.length > 0) console.log(`note: d1_migrations already lists ${applied.join(', ')}`);

  if (!apply) {
    console.log('dry run: nothing was applied. Review the SQL, then re-run with --apply.');
    process.exit(0);
  }

  console.log(`applying (bookmark ${value('--bookmark')}, export ${value('--export-file')})`);
  try {
    runner.run(['d1', 'execute', 'DB', '--remote', '--yes', '--file', resolve(out)]);
  } catch (error) {
    fail(`apply failed: ${error.message}\nRe-run the same command: it regenerates SQL from what is still missing.`);
  }
  const after = diffNow();
  const stillMissing = [...after.missingTables, ...after.missingColumns];
  if (stillMissing.length > 0 || !isAdopted(appliedMigrations())) {
    fail(`still behind baseline after apply: ${stillMissing.join(', ') || 'baseline not recorded'}`);
  }
  console.log('OK: schema matches 0000_baseline.sql and the baseline is recorded. Next: pnpm db:migrate:client');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
