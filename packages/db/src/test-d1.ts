// Test-only D1 adapter over node:sqlite, loaded with the real schema.sql.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// Loaded at runtime: Vite cannot resolve the `node:sqlite` builtin as an import.
interface SqliteStatement {
  get(...v: unknown[]): unknown;
  all(...v: unknown[]): unknown[];
  run(...v: unknown[]): { changes: number | bigint };
}
interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

type Value = string | number | null;

export interface TestD1 {
  db: D1Database;
  raw: DatabaseSync;
}

export function createTestD1(): TestD1 {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql'), 'utf8'));
  const prepare = (sql: string) => {
    const stmt = raw.prepare(sql);
    const bound = (values: Value[]) => ({
      first: async <T>() => ((stmt.get(...values) as T | undefined) ?? null),
      all: async <T>() => ({ results: stmt.all(...values) as T[] }),
      run: async () => ({ success: true, meta: { changes: Number(stmt.run(...values).changes) } }),
    });
    return { ...bound([]), bind: (...values: Value[]) => bound(values) };
  };
  return { db: { prepare } as unknown as D1Database, raw };
}
