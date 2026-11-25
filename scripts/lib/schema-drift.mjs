// Compares table/column sets between an expected schema and an actual database.
import { execFileSync } from 'node:child_process';

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
