# Runbooks and Client-0 Adoption (Plan 4 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator can onboard, offboard, rotate secrets and respond to incidents from written runbooks, and can bring the existing production D1 (client 0, created before tracked migrations) onto `d1-migrations` safely — with this plan itself making **no writes to production**.

**Architecture:** The remote drift checker is rebuilt on queries remote D1 actually allows (one `PRAGMA table_info` per table). A new adoption tool computes, from the drift against the frozen baseline, the additive SQL that brings a legacy D1 up to `0000_baseline.sql` and records the baseline in `d1_migrations`; it is dry-run by default and its apply mode is guarded. Runbooks live in `docs/runbooks/` and are checked by a test that every command they cite exists.

**Tech Stack:** Node 22 ESM scripts, `node:test`, `sqlite3` CLI, wrangler 4 (`d1 execute`, `d1 export --no-data`, `d1 time-travel info`).

**Spec:** `docs/superpowers/specs/2026-11-26-per-client-deployment-design.md` §5.5, §6, §8, §12

## Facts this plan is built on (read-only probe of production, 2026-11-26)

- `COLUMNS_QUERY` (`JOIN pragma_table_info(...)`) is refused by remote D1: `not authorized: SQLITE_AUTH`. `PRAGMA table_info(<t>)` as separate statements works. A compound SELECT over 64 tables hits `too many terms in compound SELECT`.
- Production D1 has no `d1_migrations` table and is **behind** the baseline: missing tables `broadcast_deliveries`, `form_opens`, `traffic_pools`; missing columns `broadcasts.alt_text`, `broadcasts.audience_cursor`, `broadcasts.audience_materialized_at`, `broadcasts.queue_lease_token`, `broadcasts.queue_locked_at`, `friends.first_tracked_link_id`, `friends.metadata`, `line_accounts.token_expires_at`, `messages_log.broadcast_delivery_id`. All nine are nullable or have a default; `friends.first_tracked_link_id` has `REFERENCES tracked_links (id) ON DELETE SET NULL`.
- Production holds real rows (a small number of friends, bookings, form submissions and message logs) and **zero** `staff_members`. Counts are not written into the repo.
- Production serves only on `*.workers.dev`; the client-0 custom domain is **not decided**. Rendered configs set `workers_dev = false`, so switching over turns the old URL off.

## Global Constraints

- No writes to any remote D1, no `wrangler deploy`, no secret changes while executing this plan. Remote commands allowed: `d1 execute --remote` with read-only statements, `d1 export --no-data`, `d1 time-travel info`.
- Adoption SQL is additive only: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, the `d1_migrations` table, one `INSERT` of `0000_baseline.sql`. Never DROP, UPDATE or DELETE.
- `d1_migrations` must match wrangler's own table exactly: `id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL`, row name `0000_baseline.sql`.
- Runbooks contain no account IDs, database IDs, emails, keys or customer data — the product repo is public.
- Secrets are entered only interactively (dashboard or `wrangler secret put`), never via files (spec §5.5).
- No new npm dependencies.

## Review Focus

1. Apply fails halfway (network, one bad statement) → re-running the tool regenerates SQL from the *current* drift and finishes; nothing is applied twice. (Task 2)
2. The database is already adopted (`d1_migrations` contains `0000_baseline.sql`) → the tool refuses and changes nothing. (Task 2, Task 3)
3. A missing column cannot be added with `ADD COLUMN` (PRIMARY KEY, or NOT NULL without default) → the tool stops with a message naming the column instead of emitting SQL that fails mid-run. (Task 2)
4. Wrangler returns an error object (SQLITE_AUTH, auth expired) → the checker prints the Cloudflare error text and exits 1, not a JSON parse stack trace. (Task 1)
5. A table name containing a quote or space in remote `sqlite_master` → refused before any PRAGMA is built. (Task 1)

Known gap (documented, not fixed): drift compares table and column **names** only; a column that exists with a different type or default is not detected. The runbook says so.

---

### Task 1: Remote-safe drift checker

**Files:**
- Modify: `scripts/lib/schema-drift.mjs`
- Modify: `scripts/check-d1-schema-drift.mjs`
- Test: `scripts/schema-drift.test.mjs`

**Interfaces:**
- Produces (in `scripts/lib/schema-drift.mjs`):
  - `TABLES_QUERY: string` = `"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"`
  - `pragmaBatch(tables: string[]): string` — `PRAGMA table_info("<t>");` per table; throws `Error('unsafe table name: <t>')` unless `/^[A-Za-z_][A-Za-z0-9_]*$/`.
  - `rowsFromPragmaResults(tables: string[], results: {results: {name: string}[]}[]): {t: string, c: string}[]` — throws if lengths differ.
  - `parseWranglerJson(stdout: string): {results: object[]}[]` — returns the array; if the JSON is an object with `error`, throws `Error(<error.text> + ': ' + <notes text joined>)`.
  - `remoteTableColumns(run: (args: string[]) => string): Map<string, Set<string>>` — `run` executes wrangler args and returns stdout; two calls: tables, then the pragma batch.
- Consumes: `clientWranglerInvocation(config, args)` from `scripts/lib/with-client.mjs`.

- [ ] **Step 1: Write failing tests** in `scripts/schema-drift.test.mjs`:
  - `pragmaBatch(['friends','tags'])` equals `'PRAGMA table_info("friends");PRAGMA table_info("tags");'`
  - `pragmaBatch(['a"b'])` and `pragmaBatch(['a b'])` throw `/unsafe table name/`
  - `rowsFromPragmaResults(['t1','t2'], [{results:[{name:'id'}]},{results:[{name:'id'},{name:'x'}]}])` deep-equals `[{t:'t1',c:'id'},{t:'t2',c:'id'},{t:'t2',c:'x'}]`; mismatched lengths throw.
  - `parseWranglerJson('{"error":{"text":"A request failed.","notes":[{"text":"not authorized: SQLITE_AUTH"}]}}')` throws `/SQLITE_AUTH/`.
  - `remoteTableColumns(fakeRun)` where `fakeRun` returns the tables JSON on first call and pragma JSON on second → `Map{friends→{id,name}}`, and `_cf_KV` / `d1_migrations` / `sqlite_sequence` are excluded from the pragma batch (assert on the second call's `--command` argument).
- [ ] **Step 2: Run** `node --test scripts/schema-drift.test.mjs` — Expected: FAIL (exports missing).
- [ ] **Step 3: Implement** the five exports. Filter `IGNORED_TABLES` and `sqlite_%` names before building the batch. Keep `COLUMNS_QUERY` and `tableColumns` for local sqlite.
- [ ] **Step 4: Rewire** `check-d1-schema-drift.mjs` to `remoteTableColumns`, with `run` = `execFileSync('pnpm', clientWranglerInvocation(config, ['d1','execute','DB','--remote','--json','--command', cmd]).argv, …)`; on a non-zero exit, parse `error.stdout` with `parseWranglerJson` so the Cloudflare message is printed, then exit 1.
- [ ] **Step 5: Run** `pnpm test:scripts` — Expected: all pass.
- [ ] **Step 6: Verify against production (read-only)** with a check-only client config kept outside the repo: `CLIENT_CONFIG=<scratch>/client0-check.json pnpm db:drift:client` — Expected: exit 1 and exactly the 3 `MISSING TABLE` and 9 `MISSING COLUMN` lines listed in Facts.
- [ ] **Step 7: Commit** `fix: make remote drift check use queries d1 allows`

### Task 2: Adoption SQL generator

**Files:**
- Create: `scripts/lib/adopt-legacy-d1.mjs`
- Test: `scripts/adopt-legacy-d1.test.mjs`

**Interfaces:**
- Consumes: `diffSchemas`, `tableColumns` from Task 1's module.
- Produces:
  - `D1_MIGRATIONS_DDL: string` (exact DDL from Global Constraints, with `IF NOT EXISTS`)
  - `addColumnSql(table: string, col: {name,type,notnull,dflt_value,pk}, fk?: {table,to,on_delete}): string` — e.g. `ALTER TABLE "friends" ADD COLUMN "metadata" TEXT NOT NULL DEFAULT '{}'`; FK renders ` REFERENCES "tracked_links" ("id") ON DELETE SET NULL`. Throws `Error('cannot ADD COLUMN <t>.<c>: …')` for `pk` or `notnull` without default.
  - `adoptionStatements(baselineDbPath: string, diff: {missingTables, missingColumns}): string[]` — order: (1) `CREATE TABLE IF NOT EXISTS` for each missing table (from baseline `sqlite_master.sql`, `CREATE TABLE` → `CREATE TABLE IF NOT EXISTS`), (2) `ALTER … ADD COLUMN` for each missing column of an existing table (definition from baseline `pragma_table_info` + `pragma_foreign_key_list`), (3) every baseline index as `CREATE [UNIQUE] INDEX IF NOT EXISTS`, (4) `D1_MIGRATIONS_DDL`, (5) `INSERT INTO d1_migrations (name) VALUES ('0000_baseline.sql')`.
  - `isAdopted(names: string[]): boolean` — true when `'0000_baseline.sql'` is among applied migration names.

- [ ] **Step 1: Write failing tests** (fixtures built with `sqlite3` in a temp dir from `0000_baseline.sql`):
  - `addColumnSql` renders the `friends.metadata` and `friends.first_tracked_link_id` examples above exactly; throws for `{pk:1}` and for `{notnull:1, dflt_value:null}`.
  - **legacy round-trip:** make a "legacy" db = baseline minus tables `form_opens`, `broadcast_deliveries`, `traffic_pools` and minus columns `friends.metadata`, `broadcasts.alt_text` (via `DROP TABLE` / `ALTER TABLE DROP COLUMN` on the fixture copy); apply `adoptionStatements` with `sqlite3`; assert `diffSchemas(baseline, legacy)` has no missing tables/columns, `d1_migrations` holds exactly one row `0000_baseline.sql`, and then executing `0001_auth_hardening.sql` succeeds.
  - **partial failure (Review Focus 1):** apply only the first half of the statements, recompute the diff, regenerate, apply → same end state as the round-trip, no error.
  - statements contain none of `DROP`, `DELETE`, `UPDATE` (case-insensitive word match).
  - `isAdopted(['0000_baseline.sql'])` true; `isAdopted([])` false.
- [ ] **Step 2: Run** `node --test scripts/adopt-legacy-d1.test.mjs` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `scripts/lib/adopt-legacy-d1.mjs`.
- [ ] **Step 4: Run** `pnpm test:scripts` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: generate additive sql to adopt a pre-migration d1`

### Task 3: Adoption CLI (dry run by default, guarded apply)

**Files:**
- Create: `scripts/adopt-legacy-d1.mjs`
- Modify: `package.json` (add `"db:adopt:client": "node scripts/adopt-legacy-d1.mjs --client \"$CLIENT_CONFIG\""`)
- Test: `scripts/adopt-legacy-d1-cli.test.mjs`

**Interfaces:**
- Consumes: Task 1 `remoteTableColumns`, `parseWranglerJson`, `TABLES_QUERY`; Task 2 `adoptionStatements`, `isAdopted`.
- CLI: `adopt-legacy-d1.mjs --client <json> --out <file.sql> [--apply --export-file <path> --bookmark <id> --confirm <d1DatabaseName>]`
  - Dry run (default): reads remote drift and `SELECT name FROM d1_migrations` (absent table = not adopted), writes the SQL to `--out`, prints a summary (N tables, N columns, N indexes), changes nothing remotely.
  - Already adopted → message `already adopted: d1_migrations has 0000_baseline.sql`, exit 1, writes nothing.
  - `--apply` requires all of: `--export-file` pointing to an existing non-empty file, `--bookmark` non-empty, `--confirm` equal to `config.d1DatabaseName`; otherwise exit 1 before any remote call. Apply runs `d1 execute DB --remote --file <out>`, then re-runs the drift and exits 0 only if no baseline table/column is missing.

- [ ] **Step 1: Write failing tests** (argument guards only; they must exit before any wrangler call — assert by running with a client config whose account is the fixture value and checking stderr has no wrangler banner):
  - no `--out` → exit 1, `usage:` on stderr
  - `--apply` without `--export-file` → exit 1, `/--export-file/`
  - `--apply` with an empty export file → exit 1, `/empty/`
  - `--apply` with `--confirm wrong-name` → exit 1, `/--confirm must equal/`
  - invalid client config → exit 1, `unknown key` (reuses `validateClientConfig`)
- [ ] **Step 2: Run** `node --test scripts/adopt-legacy-d1-cli.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** the CLI and package script.
- [ ] **Step 4: Run** `pnpm test:scripts` — Expected: all pass.
- [ ] **Step 5: Production dry run (read-only):** `CLIENT_CONFIG=<scratch>/client0-check.json pnpm db:adopt:client -- --out <scratch>/client0-adopt.sql` — Expected: summary `3 tables, 9 columns`, SQL file written to scratch, nothing applied. Read the SQL and confirm it contains only the statement kinds in Global Constraints.
- [ ] **Step 6: Local rehearsal on production's real schema:** `wrangler d1 export line-crm --remote --no-data --output <scratch>/client0-schema.sql` (schema only, no rows); load it into a temp sqlite; apply `<scratch>/client0-adopt.sql`; apply `0001_auth_hardening.sql`; run `diffSchemas` against baseline — Expected: nothing missing, `d1_migrations` has both names after inserting `0001_auth_hardening.sql`. Record the result in the ledger.
- [ ] **Step 7: Commit** `feat: add guarded cli to adopt a legacy d1 onto tracked migrations`

### Task 4: Runbooks

**Files:**
- Create: `docs/runbooks/README.md` — index, rules (no secrets/IDs in repo, who approves, where exports live), and the Known gap from Review Focus.
- Create: `docs/runbooks/onboarding.md` — spec §8.2 steps 1–7 with exact commands, plus: Cloudflare Access application on `adminDomain` only (policy, service token for MCP/seed), `access.aud` into `client.json`, owner bootstrap then `wrangler secret delete API_KEY`, LINE webhook/LIFF/Login callback URLs on `customDomain`.
- Create: `docs/runbooks/offboarding.md` — spec §8.3.
- Create: `docs/runbooks/incident.md` — spec §8.4: revoke Cloudflare token, deactivate/regenerate staff keys (`POST /api/staff/:id/regenerate-key`), reissue LINE channel token, `d1 time-travel info/restore`, audit_logs query for the window.
- Create: `docs/runbooks/secret-rotation.md` — spec §5.5, one section per secret (LINE, AI providers, Stripe, Google, Access service token).
- Create: `docs/runbooks/client-0-adoption.md` — legacy-D1 switchover: prerequisites (custom domain decided and in the account, Access app, ops repo deploy path from Plan 2), then in order: `time-travel info` → record bookmark; full `d1 export` to an encrypted location outside every repo; `db:drift:client`; `db:adopt:client` dry run and review; `--apply`; `db:migrate:client`; drift OK; deploy (old `workers.dev` URL stops here); switch LINE webhook, LIFF endpoint and Login callback to `customDomain`; `scripts/smoke-test.mjs`; create owner; delete `API_KEY`; real-device checklist (`docs/ai-line-crm-line-test-checklist.md`). Rollback: `time-travel restore` to the bookmark and redeploy the previous release tag; LINE URLs back to `workers.dev` (requires a render with `workers_dev` — note that this is a manual exception).
- Modify: `docs/ai-line-crm-production-checklist.md` — link to `docs/runbooks/`.
- Test: `scripts/runbooks.test.mjs`

- [ ] **Step 1: Write failing test** `scripts/runbooks.test.mjs`:
  - every file linked from `docs/runbooks/README.md` exists, and every `docs/runbooks/*.md` is linked from it
  - every `pnpm <name>` in a runbook (excluding `pnpm install`, `pnpm exec`, `pnpm --filter`) is a key of root `package.json` `scripts`
  - every `scripts/<path>.mjs` mentioned exists
  - no runbook matches `/[0-9a-f]{32}/`, `/[0-9a-f]{8}-[0-9a-f]{4}-/`, an email address, or `/lh_[0-9a-f]{8,}/`
- [ ] **Step 2: Run** `node --test scripts/runbooks.test.mjs` — Expected: FAIL (no runbooks).
- [ ] **Step 3: Write the runbooks** (Japanese, matching the spec and existing docs).
- [ ] **Step 4: Run** `pnpm test:scripts` — Expected: all pass.
- [ ] **Step 5: Commit** `docs: add onboarding, offboarding, incident, rotation and client-0 adoption runbooks`

### Task 5: Whole-branch verification

- [ ] `pnpm test:scripts`, `pnpm --filter worker test`, `pnpm --filter worker typecheck`, `pnpm --filter @line-crm/db test`, `pnpm --filter @line-harness/sdk test` — all pass.
- [ ] `git diff main --stat` shows no change under `apps/` or `packages/`.
- [ ] Confirm by command history that no remote write ran: only `d1 execute` with SELECT/PRAGMA, `d1 export --no-data`, `d1 time-travel info`.
