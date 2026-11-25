# D1 migrations (tracked)

Applied with `wrangler d1 migrations apply`, which records each file in the
`d1_migrations` table of the target database.

- `0000_baseline.sql` is a byte copy of `../schema.sql` at the time tracking began.
  Every statement is idempotent (`CREATE ... IF NOT EXISTS`), so applying it to an
  existing database creates nothing that already exists. It does **not** add
  missing columns to existing tables: run `scripts/check-d1-schema-drift.mjs`
  against an existing database before relying on it.
- Every new schema change is a new file `NNNN_short_name.sql` here, **and** the same
  change folded into `../schema.sql`. `scripts/d1-migrations.test.mjs` fails if the
  two disagree.
- Destructive changes (DROP, column type change) ship in two releases:
  add + migrate data first, remove in a later release.
