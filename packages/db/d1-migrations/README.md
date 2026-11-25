# D1 migrations (tracked)

Applied with `wrangler d1 migrations apply`, which records each file in the
`d1_migrations` table of the target database.

- `0000_baseline.sql` is **frozen**: it is the copy of `../schema.sql` taken when tracking
  began, and must never be edited (`scripts/d1-migrations.test.mjs` pins its SHA-256).
  Every statement is idempotent (`CREATE ... IF NOT EXISTS`), so applying it to an
  existing database creates nothing that already exists. It does **not** add
  missing columns to existing tables: run `pnpm db:drift:client` against an existing
  database before relying on it. The drift check compares against this baseline only;
  columns added by later migrations are not "missing" — never add them by hand, or
  their `ALTER TABLE` migration will fail with a duplicate column.
- Every new schema change is a new file `NNNN_short_name.sql` here (it may use
  `ALTER TABLE`), **and** the same change applied to `../schema.sql`, so that
  `schema.sql` always equals baseline + all migrations. The test fails if they disagree.
- Destructive changes (DROP, column type change) ship in two releases:
  add + migrate data first, remove in a later release.
