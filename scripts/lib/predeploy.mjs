// Decides whether `wrangler d1 migrations apply` may run against a client's D1.
//   empty   – brand-new database: migrations create everything
//   legacy  – has tables but the baseline was never recorded: must be adopted first
//   adopted – baseline recorded: allowed only when no baseline table/column is missing
import { isAdopted } from './adopt-legacy-d1.mjs';
import { parseWranglerJson, remoteQueryArgs, TABLES_QUERY } from './schema-drift.mjs';

const isUserTable = (t) => t !== 'd1_migrations' && !t.startsWith('_cf_') && !t.startsWith('sqlite_');

/**
 * @param {{ tables: string[], applied: string[], diff: {missingTables: string[], missingColumns: string[]} }} input
 * @returns {{ state: 'empty'|'legacy'|'adopted', ok: boolean, message: string }}
 */
export function classifyD1({ tables, applied, diff }) {
  if (!tables.some(isUserTable)) {
    return { state: 'empty', ok: true, message: 'empty database: migrations will create the schema' };
  }
  if (!isAdopted(applied)) {
    return {
      state: 'legacy',
      ok: false,
      message: 'tables exist but 0000_baseline.sql is not recorded: follow docs/runbooks/client-0-adoption.md before deploying',
    };
  }
  const missing = [...diff.missingTables, ...diff.missingColumns];
  if (missing.length > 0) {
    return { state: 'adopted', ok: false, message: `schema is behind 0000_baseline.sql: ${missing.join(', ')}` };
  }
  return { state: 'adopted', ok: true, message: `baseline recorded; applied: ${applied.join(', ')}` };
}

/** @param {(args: string[]) => string} run */
export function remoteTables(run) {
  return parseWranglerJson(run(remoteQueryArgs(TABLES_QUERY))).flatMap((r) => r.results ?? []).map((r) => r.name);
}

/** @param {(args: string[]) => string} run @param {string[]} tables */
export function remoteAppliedMigrations(run, tables) {
  if (!tables.includes('d1_migrations')) return [];
  return parseWranglerJson(run(remoteQueryArgs('SELECT name FROM d1_migrations ORDER BY id')))
    .flatMap((r) => r.results ?? [])
    .map((r) => r.name);
}
