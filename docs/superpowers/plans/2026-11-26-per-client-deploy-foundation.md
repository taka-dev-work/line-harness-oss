# Per-Client Deploy Foundation (Plan 1 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the product repository deployable to any client's own Cloudflare account from a per-client config file, with no account IDs in the repo, tracked D1 migrations, and a post-deploy smoke test.

**Architecture:** The product repo owns the tooling (config validator, wrangler config renderer, migration layout, smoke test, schema drift check). The private ops repo (Plan 2) will only hold `client.json` data and call these scripts at a pinned commit. `apps/worker/wrangler.toml` becomes a dev-only template; production always deploys from a rendered, gitignored `apps/worker/wrangler.client.toml`.

**Tech Stack:** Node 22 ESM scripts tested with `node --test`, wrangler 4 (`d1 migrations`), sqlite3 CLI (already used by worker tests), pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-11-26-per-client-deployment-design.md` (§5.1, §5.2, §5.3 steps 4/6/8, §6)

**Out of scope (later plans):** Plan 2 = ops repo + GitHub Actions workflow + D1 Time Travel bookmark + Cloudflare token handling. Plan 3 = staff key hashing, audit log, Cloudflare Access JWT check. Plan 4 = runbooks and client-0 migration.

## Global Constraints

- No Cloudflare account ID, D1 database ID, or client domain may remain in tracked files of the product repo (placeholders `YOUR_DEV_ACCOUNT_ID` / `YOUR_DEV_D1_DATABASE_ID` stay).
- `client.json` must never contain secrets; validator rejects unknown keys.
- Rendered config sets `workers_dev = false`; the worker is reachable only via `customDomain` and `adminDomain`.
- No GitHub workflow in the public repo may deploy.
- Scripts are plain `.mjs`, no new npm dependencies.
- All new tests run with `node --test scripts/` from repo root; add root script `"test:scripts": "node --test scripts/"`.
- Secrets are never printed by any script.

## Review Focus

1. A `client.json` where someone pastes a secret (e.g. `build.LINE_CHANNEL_SECRET`) → validator must reject it, not render it. (Task 1)
2. Domains typed with uppercase, a scheme, a path or trailing dot (`https://Line.Acme.example/`) → rejected with a message naming the field, not silently rendered. (Task 1)
3. Existing production D1 created by older migrations is missing columns that `schema.sql` defines; because baseline uses `CREATE TABLE IF NOT EXISTS`, applying it is a silent no-op → drift check must report the missing columns. (Task 4)
4. Smoke test given a base URL with trailing slash or a URL that redirects to a login page → checks must still use the right paths and must not follow redirects into a false 200. (Task 5)
5. `customDomain` equal to `adminDomain` → rejected, because Access protection (Plan 3) needs a separate admin host. (Task 1)

---

### Task 1: Client config validator

**Files:**
- Create: `scripts/lib/client-config.mjs`
- Test: `scripts/client-config.test.mjs`

**Interfaces:**
- Produces: `validateClientConfig(raw: unknown): { ok: true, config: ClientConfig } | { ok: false, errors: string[] }`
- `ClientConfig` shape (all required unless noted):
  `slug` (`/^[a-z][a-z0-9-]{1,30}$/`), `displayName` (non-empty string), `cloudflareAccountId` (`/^[0-9a-f]{32}$/`), `workerName` (`/^[a-z][a-z0-9-]{1,62}$/`), `d1DatabaseName` (same pattern as workerName), `d1DatabaseId` (lowercase UUID), `customDomain` and `adminDomain` (lowercase hostname, ≥2 labels, no scheme/path/port/trailing dot, must differ), `release.tag` (`/^v\d+\.\d+\.\d+(-nibel\.\d+)?$/`), `release.commit` (`/^[0-9a-f]{40}$/`), `build` (object of string values; allowed keys exactly `VITE_LIFF_ID`, `VITE_BOT_BASIC_ID`, `VITE_CALENDAR_CONNECTION_ID`, `NEXT_PUBLIC_API_URL`; optional keys may be omitted), `vars` (optional; allowed keys exactly `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`).
- Any unknown key at any level → error `unknown key: <path>`.

- [ ] **Step 1: Write failing tests** in `scripts/client-config.test.mjs` using `node:test` and `node:assert/strict`, with a `validFixture()` helper returning a complete valid object:
  - `accepts a complete valid config` → `ok === true`
  - `rejects unknown key` with `build.LINE_CHANNEL_SECRET: 'x'` → errors include `unknown key: build.LINE_CHANNEL_SECRET`
  - `rejects top-level unknown key` `apiToken` → errors include `unknown key: apiToken`
  - `rejects domain with scheme, uppercase, path or trailing dot` → one case each for `https://line.acme.example`, `Line.acme.example`, `line.acme.example/x`, `line.acme.example.`; every error string contains `customDomain`
  - `rejects identical customDomain and adminDomain` → error contains `adminDomain must differ from customDomain`
  - `rejects short commit` (`abc123`) → error contains `release.commit`
  - `rejects uppercase account id` → error contains `cloudflareAccountId`
  - `reports all errors at once` → config with 3 bad fields yields `errors.length === 3`
- [ ] **Step 2: Run** `node --test scripts/client-config.test.mjs` → FAIL (module not found)
- [ ] **Step 3: Implement** `validateClientConfig` in `scripts/lib/client-config.mjs`; collect errors rather than throwing.
- [ ] **Step 4: Run** `node --test scripts/client-config.test.mjs` → all PASS
- [ ] **Step 5: Add** root `package.json` script `"test:scripts": "node --test scripts/"`; run `pnpm test:scripts` → PASS
- [ ] **Step 6: Commit** `feat: validate per-client deploy config`

### Task 2: Wrangler config renderer

**Files:**
- Create: `scripts/lib/render-wrangler.mjs`, `scripts/render-wrangler-config.mjs` (CLI)
- Test: `scripts/render-wrangler.test.mjs`

**Interfaces:**
- Consumes: `validateClientConfig` (Task 1)
- Produces: `renderWranglerToml(config: ClientConfig): string`, `renderWebBuildEnv(config: ClientConfig): Record<string,string>`
- CLI: `node scripts/render-wrangler-config.mjs --client <path/to/client.json> --out apps/worker/wrangler.client.toml [--web-env-out <path>]`; exit 1 printing each validation error on its own line; never prints `build` values.

Rendered TOML must contain, in this order: `name = "<workerName>"`, `main = "src/index.ts"`, `compatibility_date = "2024-12-01"`, `workers_dev = false`, `account_id = "<cloudflareAccountId>"`, `[vars]` (from `vars`, defaults `OPENAI_MODEL = "gpt-5-mini"`, `ANTHROPIC_MODEL = "claude-sonnet-5"`, `GEMINI_MODEL = "gemini-3.6-flash"`), `[assets] directory = "../web/out"` `binding = "ASSETS"`, `[[d1_databases]] binding = "DB"` with `database_name`, `database_id`, `migrations_dir = "../../packages/db/d1-migrations"`, `[triggers] crons = ["*/5 * * * *"]`, and two `[[routes]]` entries `{ pattern = "<domain>", custom_domain = true }` for `customDomain` then `adminDomain`. Header comment: `# GENERATED from client.json — do not edit or commit`.

- [ ] **Step 1: Write failing tests:**
  - `renders account and database ids` → output includes `account_id = "<fixture id>"` and `database_id = "<fixture uuid>"`
  - `disables workers.dev` → includes `workers_dev = false`
  - `renders both custom domain routes` → two matches of `custom_domain = true`, customDomain before adminDomain
  - `points migrations_dir at d1-migrations` → includes `migrations_dir = "../../packages/db/d1-migrations"`
  - `uses default model vars when vars omitted` → includes `OPENAI_MODEL = "gpt-5-mini"`
  - `escapes quotes in values` → a `displayName` is not rendered at all (assert output does not include it), and a `vars.OPENAI_MODEL` of `a"b` renders as `"a\"b"`
  - `renderWebBuildEnv returns only build keys` → deepEqual to fixture `build`
  - CLI test via `execFileSync('node', [...])` on a temp invalid file → exit code 1, stderr contains `unknown key`, stdout empty
- [ ] **Step 2: Run** `node --test scripts/render-wrangler.test.mjs` → FAIL
- [ ] **Step 3: Implement** renderer and CLI (write web env as `KEY=value` lines only when `--web-env-out` given).
- [ ] **Step 4: Run** `pnpm test:scripts` → PASS
- [ ] **Step 5: Verify with wrangler** using a fixture client file: `node scripts/render-wrangler-config.mjs --client <fixture> --out apps/worker/wrangler.client.toml && pnpm exec wrangler deploy --dry-run --config apps/worker/wrangler.client.toml --outdir /tmp/wrangler-dry` → exits 0 (requires `apps/web/out` to exist; run `pnpm --filter web build` first)
- [ ] **Step 6: Commit** `feat: render per-client wrangler config`

### Task 3: Remove production identity and auto-deploy from the product repo

**Files:**
- Modify: `apps/worker/wrangler.toml` (delete the whole `[env.production…]` block, lines 37–end)
- Modify: `package.json` scripts: replace `deploy:worker:production` and `db:migrate`; add `deploy:client`
- Modify: `.gitignore` (add `apps/worker/wrangler.client.toml`, `clients/`)
- Delete: `.github/workflows/deploy-worker.yml`
- Modify: `docs/ai-line-crm-production-checklist.md` §3–5, `docs/ai-line-crm-installation-guide.md` §4–6, `CLAUDE.md` Useful Commands (replace `--env production` usage with the `deploy:client` flow)
- Test: `scripts/repo-hygiene.test.mjs`

**Interfaces:**
- Produces root scripts:
  - `"deploy:client": "node scripts/render-wrangler-config.mjs --client $CLIENT_CONFIG --out apps/worker/wrangler.client.toml --web-env-out apps/web/.env.production.local && pnpm --filter web build && pnpm exec wrangler deploy --config apps/worker/wrangler.client.toml"`
  - `"db:migrate:client": "pnpm exec wrangler d1 migrations apply DB --remote --config apps/worker/wrangler.client.toml"`
  - `"db:migrate:local": "pnpm exec wrangler d1 migrations apply DB --local --config apps/worker/wrangler.toml"`
  - remove `db:migrate` and `deploy:worker:production`

- [ ] **Step 1: Write failing tests** in `scripts/repo-hygiene.test.mjs`:
  - `wrangler.toml has no real account id` → content has no match for `/account_id\s*=\s*"[0-9a-f]{32}"/`
  - `wrangler.toml has no real d1 id` → no match for `/database_id\s*=\s*"[0-9a-f-]{36}"/`
  - `no deploy workflow in public repo` → no file under `.github/workflows/` contains `wrangler-action` or `wrangler deploy`
  - `rendered config is gitignored` → `git check-ignore apps/worker/wrangler.client.toml` exits 0
- [ ] **Step 2: Run** `node --test scripts/repo-hygiene.test.mjs` → FAIL (3 failures; gitignore one fails)
- [ ] **Step 3: Apply** the file changes listed above.
- [ ] **Step 4: Run** `pnpm test:scripts` → PASS; `cd apps/worker && npx vitest run` → 136 passed
- [ ] **Step 5: Commit** `chore: remove production identity and auto-deploy from product repo`

### Task 4: Tracked D1 migrations with baseline and drift check

**Files:**
- Create: `packages/db/d1-migrations/0000_baseline.sql` (byte copy of `packages/db/schema.sql`)
- Create: `packages/db/d1-migrations/README.md` (rule: new schema changes = new `NNNN_name.sql` here AND the same change folded into `schema.sql`; destructive changes split across two releases per spec §6)
- Create: `scripts/lib/schema-drift.mjs`, `scripts/check-d1-schema-drift.mjs` (CLI)
- Test: `scripts/d1-migrations.test.mjs`, `scripts/schema-drift.test.mjs`

**Interfaces:**
- Produces: `tableColumns(sqliteDbPath: string): Map<string, Set<string>>` (via `sqlite3 -json <db> "SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table'"`), `diffSchemas(expected: Map, actual: Map): { missingTables: string[], missingColumns: string[] /* "table.column" */, extraTables: string[] }`
- CLI: `node scripts/check-d1-schema-drift.mjs --config apps/worker/wrangler.client.toml` runs the same query remotely with `wrangler d1 execute DB --remote --json --command …`, builds expected from a temp sqlite loaded with `schema.sql`, prints the diff, exits 1 if `missingTables` or `missingColumns` non-empty. Ignores tables `d1_migrations`, `_cf_KV`, `sqlite_sequence`.

- [ ] **Step 1: Write failing tests:**
  - `d1-migrations.test.mjs`: `baseline equals schema.sql` (byte compare); `migrations apply cleanly to empty db` (apply every file in `d1-migrations` sorted by name into a temp sqlite3 DB, exit 0); `migrated schema equals schema.sql schema` (compare `tableColumns` of the two temp DBs, `diffSchemas` all empty); `file names are NNNN_name.sql` (`/^\d{4}_[a-z0-9_]+\.sql$/`)
  - `schema-drift.test.mjs`: `reports missing column` — expected `{friends:{id,name,score}}`, actual `{friends:{id,name}}` → `missingColumns` deepEqual `['friends.score']`; `reports missing table`; `reports extra table without failing` (extraTables only)
- [ ] **Step 2: Run** `pnpm test:scripts` → FAIL
- [ ] **Step 3: Implement** files above. Do not delete `packages/db/migrations/` (historical record) but add one line to its top-level README or a new `packages/db/migrations/README.md`: "Frozen. New changes go to ../d1-migrations."
- [ ] **Step 4: Run** `pnpm test:scripts` → PASS
- [ ] **Step 5: Commit** `feat: track d1 migrations with baseline and drift check`

### Task 5: Post-deploy smoke test

**Files:**
- Create: `scripts/lib/smoke.mjs`, `scripts/smoke-test.mjs` (CLI)
- Test: `scripts/smoke.test.mjs`

**Interfaces:**
- Produces: `runSmokeChecks(baseUrl: string, fetchImpl = fetch): Promise<{ name: string, ok: boolean, status: number }[]>`
- Checks (all with `redirect: 'manual'`, base URL normalized by stripping trailing `/`):
  1. `openapi` — `GET /openapi.json` → ok iff status 200
  2. `forms-put-requires-auth` — `PUT /api/forms/smoke-nonexistent-00000000` body `{}` → ok iff 401
  3. `staff-list-requires-auth` — `GET /api/staff` → ok iff 401
  4. `stripe-webhook-rejects-unsigned` — `POST /api/integrations/stripe/webhook` body `{}` → ok iff status is 400 or 503
- CLI: `node scripts/smoke-test.mjs --base-url https://line.acme.example` prints one line per check `PASS|FAIL name status`, exit 1 if any FAIL.

- [ ] **Step 1: Write failing tests** with a stub `fetchImpl` keyed by `METHOD path`:
  - `all pass on a hardened server` (200, 401, 401, 503) → every `ok`
  - `flags unauthenticated form update` (PUT returns 404) → that check `ok === false`
  - `treats redirect as failure` (openapi returns 302) → openapi `ok === false`
  - `normalizes trailing slash` → stub sees path `/openapi.json`, not `//openapi.json`
  - `sends redirect manual` → stub asserts `init.redirect === 'manual'` on every call
- [ ] **Step 2: Run** `node --test scripts/smoke.test.mjs` → FAIL
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:scripts` → PASS; then against current production `node scripts/smoke-test.mjs --base-url https://ai-line-crm.takanorixai.workers.dev` → 4 PASS (record actual output in the commit message body; if stripe check fails because the secret is set and returns 400, it still passes; any other result is a finding to report, not to "fix" in the test)
- [ ] **Step 5: Commit** `feat: add post-deploy smoke test`

### Task 6: Whole-branch verification

- [ ] **Step 1:** `pnpm install --frozen-lockfile && pnpm --filter @line-crm/shared --filter @line-crm/line-sdk --filter @line-crm/db build`
- [ ] **Step 2:** `pnpm test:scripts` → all PASS
- [ ] **Step 3:** `cd apps/worker && npx vitest run && npx tsc --noEmit; echo $?` → 136 passed, exit 0
- [ ] **Step 4:** `git grep -nE 'f3f7f68bed5ad92623051bb800350d5b|461506df-bd6e-4d2d-a514-637ed9bbf803'` → only matches in `docs/` history notes, none in config or scripts (remove any that remain outside docs)
- [ ] **Step 5:** Report results; do not push or merge without the user's instruction.
