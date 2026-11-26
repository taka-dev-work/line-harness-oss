// Compares table/column sets between an expected schema and an actual database.
import { execFileSync } from 'node:child_process';

/**
 * Drift is measured against the frozen baseline: later migrations (ALTER TABLE …)
 * add their own columns when applied, so they must not be reported as missing —
 * an operator "repairing" them by hand would make those migrations fail.
 */
export const EXPECTED_SCHEMA_FILE = 'packages/db/d1-migrations/0000_baseline.sql';

export const COLUMNS_QUERY =
  "SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table'";
const IGNORED_TABLES = new Set(['d1_migrations', '_cf_KV', 'sqlite_sequence']);

/** @param {{t: string, c: string}[]} rows */
export function columnsFromRows(rows) {
  const tables = new Map();
  for (const { t, c } of rows) {
    if (IGNORED_TABLES.has(t)) continue;
    if (!tables.has(t)) tables.set(t, new Set());
    tables.get(t).add(c);
  }
  return tables;
}

/** @returns {Map<string, Set<string>>} */
export function tableColumns(sqliteDbPath) {
  const out = execFileSync('sqlite3', ['-json', sqliteDbPath, COLUMNS_QUERY], { encoding: 'utf8' });
  return columnsFromRows(out.trim() ? JSON.parse(out) : []);
}

/**
 * @param {Map<string, Set<string>>} expected
 * @param {Map<string, Set<string>>} actual
 */
export function diffSchemas(expected, actual) {
  const missingTables = [];
  const missingColumns = [];
  for (const [table, columns] of expected) {
    const have = actual.get(table);
    if (!have) {
      missingTables.push(table);
      continue;
    }
    for (const column of columns) if (!have.has(column)) missingColumns.push(`${table}.${column}`);
  }
  const extraTables = [...actual.keys()].filter((t) => !expected.has(t));
  return { missingTables: missingTables.sort(), missingColumns: missingColumns.sort(), extraTables: extraTables.sort() };
}

// --- Remote D1 ---------------------------------------------------------------
// Remote D1 refuses `pragma_table_info()` as a table-valued function (SQLITE_AUTH)
// and caps compound SELECTs, so columns are read with one PRAGMA per table.

export const TABLES_QUERY = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name";
const SAFE_TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** @param {string[]} tables */
export function pragmaBatch(tables) {
  return tables
    .map((t) => {
      if (!SAFE_TABLE.test(t)) throw new Error(`unsafe table name: ${t}`);
      return `PRAGMA table_info("${t}");`;
    })
    .join('');
}

/**
 * @param {string[]} tables
 * @param {{results: {name: string}[]}[]} results
 * @returns {{t: string, c: string}[]}
 */
export function rowsFromPragmaResults(tables, results) {
  if (tables.length !== results.length) {
    throw new Error(`expected ${tables.length} tables but ${results.length} results`);
  }
  return tables.flatMap((t, i) => (results[i].results ?? []).map((col) => ({ t, c: col.name })));
}

/** @param {string} stdout */
export function parseWranglerJson(stdout) {
  const parsed = JSON.parse(stdout.trim());
  if (parsed && !Array.isArray(parsed) && parsed.error) {
    const notes = (parsed.error.notes ?? []).map((n) => n.text).join('; ');
    throw new Error(notes ? `${parsed.error.text}: ${notes}` : String(parsed.error.text));
  }
  return parsed;
}

/** wrangler args for a read-only remote statement */
export const remoteQueryArgs = (command) => ['d1', 'execute', 'DB', '--remote', '--json', '--command', command];

/**
 * @param {(args: string[]) => string} run executes wrangler with args and returns stdout
 * @returns {Map<string, Set<string>>}
 */
export function remoteTableColumns(run) {
  const tables = parseWranglerJson(run(remoteQueryArgs(TABLES_QUERY)))
    .flatMap((r) => r.results ?? [])
    .map((r) => r.name)
    .filter((t) => !IGNORED_TABLES.has(t) && !t.startsWith('sqlite_') && !t.startsWith('_cf_'));
  if (tables.length === 0) return new Map();
  const results = parseWranglerJson(run(remoteQueryArgs(pragmaBatch(tables))));
  return columnsFromRows(rowsFromPragmaResults(tables, results));
}
