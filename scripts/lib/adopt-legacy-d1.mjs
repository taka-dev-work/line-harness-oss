// Builds the additive SQL that brings a D1 created before tracked migrations
// (no d1_migrations table) up to 0000_baseline.sql, then records the baseline as
// applied so `wrangler d1 migrations apply` continues from 0001.
// Statements are generated from the *current* drift, so re-running after a
// partial failure only emits what is still missing.
import { execFileSync } from 'node:child_process';

export const BASELINE_MIGRATION = '0000_baseline.sql';

// Identical to the table wrangler creates (see wrangler's d1 migrations helpers).
export const D1_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

const q = (name) => `"${name}"`;
const query = (db, statement) => {
  const out = execFileSync('sqlite3', ['-json', db, statement], { encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : [];
};
const literal = (s) => `'${String(s).replaceAll("'", "''")}'`;

/**
 * @param {string} table
 * @param {{name: string, type: string, notnull: number, dflt_value: string|null, pk: number}} col
 * @param {{table: string, to: string, on_delete?: string}} [fk]
 */
export function addColumnSql(table, col, fk) {
  if (col.pk) throw new Error(`cannot ADD COLUMN ${table}.${col.name}: column is part of the primary key`);
  if (col.notnull && col.dflt_value == null) {
    throw new Error(`cannot ADD COLUMN ${table}.${col.name}: NOT NULL without a default`);
  }
  let out = `ALTER TABLE ${q(table)} ADD COLUMN ${q(col.name)}`;
  if (col.type) out += ` ${col.type}`;
  if (col.notnull) out += ' NOT NULL';
  if (col.dflt_value != null) out += ` DEFAULT ${col.dflt_value}`;
  if (fk) {
    out += ` REFERENCES ${q(fk.table)} (${q(fk.to)})`;
    if (fk.on_delete && fk.on_delete !== 'NO ACTION') out += ` ON DELETE ${fk.on_delete}`;
  }
  return out;
}

// Column definition text inside a CREATE TABLE statement (top-level comma split).
function columnDefinition(createSql, column) {
  const body = createSql.slice(createSql.indexOf('(') + 1, createSql.lastIndexOf(')'));
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '(') depth += 1;
    else if (body[i] === ')') depth -= 1;
    else if (body[i] === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).find((p) => p.split(/\s+/)[0].replaceAll(/["`[\]]/g, '') === column) ?? '';
}

/**
 * @param {string} baselineDbPath sqlite file built from 0000_baseline.sql
 * @param {{missingTables: string[], missingColumns: string[]}} diff
 * @returns {string[]}
 */
export function adoptionStatements(baselineDbPath, diff) {
  const objects = query(baselineDbPath, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL");
  const tableSql = new Map(objects.filter((o) => o.type === 'table').map((o) => [o.name, o.sql]));
  const missingTables = new Set(diff.missingTables);
  const statements = [];

  for (const table of diff.missingTables) {
    statements.push(tableSql.get(table).replace(/^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i, 'CREATE TABLE IF NOT EXISTS '));
  }

  for (const entry of diff.missingColumns) {
    const [table, column] = entry.split('.');
    if (missingTables.has(table)) continue;
    const col = query(baselineDbPath, `SELECT * FROM pragma_table_info(${literal(table)}) WHERE name = ${literal(column)}`)[0];
    const def = columnDefinition(tableSql.get(table), column);
    if (/\b(CHECK|UNIQUE|COLLATE|GENERATED)\b/i.test(def)) {
      throw new Error(`cannot ADD COLUMN ${table}.${column}: definition has a constraint ADD COLUMN cannot carry (${def})`);
    }
    const fks = query(baselineDbPath, `SELECT * FROM pragma_foreign_key_list(${literal(table)}) WHERE "from" = ${literal(column)}`);
    statements.push(addColumnSql(table, col, fks[0]));
  }

  for (const index of objects.filter((o) => o.type === 'index')) {
    statements.push(index.sql.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?/i, (_, u = '') => `CREATE ${u}INDEX IF NOT EXISTS `));
  }

  statements.push(D1_MIGRATIONS_DDL);
  statements.push(`INSERT INTO d1_migrations (name) VALUES (${literal(BASELINE_MIGRATION)})`);
  return statements;
}

/** @param {string[]} appliedNames names in d1_migrations */
export const isAdopted = (appliedNames) => appliedNames.includes(BASELINE_MIGRATION);
