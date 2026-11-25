# Admin Auth Hardening (Plan 3 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff API keys are stored hashed and shown once, the env owner key only works for bootstrap, every authenticated change is audit-logged, and when Cloudflare Access is configured the admin API refuses requests that did not pass through Access.

**Architecture:** DB layer (`packages/db/src/staff.ts`, new `audit-logs.ts`) owns hashing and persistence; worker middleware (`auth.ts`, new `audit.ts`, new `access-jwt.ts`) enforces. Schema changes ship as the first tracked migration `0001_auth_hardening.sql`, which first requires fixing the Plan 1 migration rule so `ALTER TABLE` migrations are possible. SDK/MCP gain optional Access service-token headers so automation keeps working behind Access.

**Tech Stack:** Hono on Cloudflare Workers, D1, WebCrypto (SHA-256, RS256 verify, `crypto.subtle.timingSafeEqual`), vitest, node:test for scripts.

**Spec:** `docs/superpowers/specs/2026-11-26-per-client-deployment-design.md` §7 (and §2: client domain mandatory → Access mandatory)

## Global Constraints

- Staff keys: stored as `sha256:<64 hex>`; plaintext returned only in the create and regenerate responses.
- Display hint: `lh_****<last 4 chars>` from new column `api_key_hint`.
- Env `API_KEY` / `LEGACY_API_KEY` accepted only while there is **no active owner** in `staff_members`.
- Audit log: only POST/PUT/PATCH/DELETE on staff-authenticated requests; fields: who, when, method, path (no query string), status, IP, Access email. **Never** request body, query string or headers. Retention 365 days.
- Access: when `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are both set, every staff-authenticated request needs a valid `Cf-Access-Jwt-Assertion`; public paths unchanged. One of the two set without the other = fail closed (500 on authenticated routes).
- `client.json` gains required `access: { teamDomain, aud }` (spec §2 makes client domain and Access mandatory).
- No new npm dependencies.

## Review Focus

1. A deployment upgraded from plaintext keys: an existing staff key must keep working on first use and the row must be rewritten to the hash. (Task 3)
2. Owner lockout: after the env key is disabled, deactivating or deleting every owner must not leave the instance unrecoverable — env key works again when no active owner remains. (Task 4)
3. Access half-configured (only `ACCESS_AUD` set) must fail closed, never silently disable the check. (Task 6)
4. JWKS fetch fails or the token's `kid` is unknown (key rotation) → refetch once, then 403; never accept an unverified token. (Task 6)
5. Audit insert throws → the user's request still succeeds; the log row never contains the Authorization header, body or query string. (Task 5)

---

### Task 1: Freeze the baseline so ALTER migrations work

**Files:**
- Modify: `scripts/d1-migrations.test.mjs`
- Modify: `packages/db/d1-migrations/README.md`

**Interfaces:**
- Produces: rule "`0000_baseline.sql` is frozen; `schema.sql` = baseline + every later migration". Later tasks add `0001_*.sql` with `ALTER TABLE`.

- [ ] **Step 1: Change tests:** replace `baseline equals schema.sql` with `baseline is frozen` — sha256 of `0000_baseline.sql` equals the constant `BASELINE_SHA256` (compute once from the current file and paste the hex). Keep `migrations apply cleanly to empty db` and `migrated schema equals schema.sql schema`.
- [ ] **Step 2: Run** `pnpm test:scripts` → PASS (baseline unchanged so far; this task only loosens a rule that Task 2 would otherwise break)
- [ ] **Step 3: Update README:** new changes = new `NNNN_name.sql` **and** the same change applied to `schema.sql`; never edit `0000_baseline.sql`.
- [ ] **Step 4: Commit** `chore: freeze d1 baseline so later migrations can alter tables`

### Task 2: Migration 0001 — audit log table and key hint column

**Files:**
- Create: `packages/db/d1-migrations/0001_auth_hardening.sql`
- Modify: `packages/db/schema.sql` (staff_members gains `api_key_hint TEXT`; new `audit_logs` table + index)

**Interfaces:**
- Produces table `audit_logs(id TEXT PRIMARY KEY, staff_id TEXT NOT NULL, staff_name TEXT NOT NULL, role TEXT NOT NULL, access_email TEXT, method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL, ip TEXT, created_at TEXT NOT NULL)`, index `idx_audit_logs_created_at ON audit_logs(created_at)`.
- Produces column `staff_members.api_key_hint TEXT` (nullable).

- [ ] **Step 1:** Write the migration (`ALTER TABLE staff_members ADD COLUMN api_key_hint TEXT;` + `CREATE TABLE IF NOT EXISTS audit_logs …` + index) and apply the same to `schema.sql`.
- [ ] **Step 2: Run** `pnpm test:scripts` → PASS (`migrated schema equals schema.sql schema` proves both agree); then `pnpm exec wrangler d1 migrations apply DB --local --config apps/worker/wrangler.toml --persist-to <tmpdir>` → applies 0000 and 0001
- [ ] **Step 3: Commit** `feat: add audit log table and staff key hint`

### Task 3: Hash staff keys (DB layer + staff routes)

**Files:**
- Modify: `packages/db/src/staff.ts`, `packages/db/src/index.ts` (exports)
- Modify: `apps/worker/src/routes/staff.ts`
- Test: `packages/db/src/staff.test.ts` (new, RecordingDb pattern from `ai-concierge.test.ts`), `apps/worker/src/routes/staff.test.ts` (new)

**Interfaces:**
- Produces in `@line-crm/db`:
  - `hashApiKey(key: string): Promise<string>` → `'sha256:' + hex`
  - `apiKeyHint(key: string): string` → last 4 chars
  - `createStaffMember(db, input): Promise<{ member: StaffMember; apiKey: string }>` (was `Promise<StaffMember>`)
  - `regenerateStaffApiKey(db, id): Promise<string>` (unchanged signature; now stores hash + hint)
  - `getStaffByApiKey(db, token): Promise<StaffMember | null>` — looks up `api_key = hash`; if not found, looks up `api_key = token` (legacy plaintext) and, when found, rewrites that row to hash + hint before returning
  - `rehashPlaintextStaffKeys(db): Promise<number>` — rewrites every row whose `api_key` does not start with `sha256:`; returns count
  - `StaffMember` gains `api_key_hint: string | null`
- Produces route `POST /api/staff/rehash-keys` (owner only) → `{ success: true, data: { rehashed: number } }`
- `serializeStaff` shows `lh_****${api_key_hint ?? '????'}` and never the stored value; create response returns the plaintext from `createStaffMember().apiKey`.

- [ ] **Step 1: Write failing tests** (`staff.test.ts` in db):
  - `hashApiKey is sha256 hex with prefix` → `await hashApiKey('lh_abc')` matches `/^sha256:[0-9a-f]{64}$/` and is stable across calls
  - `createStaffMember stores hash and hint, returns plaintext once` → INSERT values contain `sha256:` value and hint equal to last 4 of returned `apiKey`; no bound value equals the plaintext
  - `getStaffByApiKey finds by hash`
  - `getStaffByApiKey upgrades legacy plaintext row` → first lookup misses, second (plaintext) hits, then an `UPDATE staff_members SET api_key = ?, api_key_hint = ?` is issued with the hash
  - `regenerateStaffApiKey stores hash`
  - worker `staff.test.ts`: `list never exposes stored key` → response `apiKey` equals `lh_****1234` for a row with hint `1234`; `create returns plaintext key once`
- [ ] **Step 2: Run** `cd packages/db && npx vitest run src/staff.test.ts` and `cd apps/worker && npx vitest run src/routes/staff.test.ts` → FAIL
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** both test files → PASS; `cd apps/worker && npx vitest run && npx tsc --noEmit` → all pass, exit 0
- [ ] **Step 5: Commit** `feat: store staff api keys as sha-256 hashes`

### Task 4: Bootstrap-only env key with constant-time compare

**Files:**
- Modify: `apps/worker/src/middleware/auth.ts`
- Test: `apps/worker/src/middleware/auth.test.ts` (extend)

**Interfaces:**
- Consumes: `getStaffByApiKey`, `countActiveStaffByRole` from `@line-crm/db`
- Produces: `secureEquals(a: string, b: string): Promise<boolean>` exported from `auth.ts` (SHA-256 both, `crypto.subtle.timingSafeEqual` on digests)

- [ ] **Step 1: Write failing tests:**
  - `env API_KEY works when no active owner exists` → 200
  - `env API_KEY is rejected once an active owner exists` → 401
  - `env API_KEY works again after every owner is deactivated` (count returns 0) → 200
  - `LEGACY_API_KEY follows the same rule`
  - `secureEquals` true for equal, false for different and for different lengths
- [ ] **Step 2: Run** `cd apps/worker && npx vitest run src/middleware/auth.test.ts` → FAIL
- [ ] **Step 3: Implement:** staff lookup first; only if no staff match, check `countActiveStaffByRole(db, 'owner') === 0` before comparing env keys with `secureEquals`.
- [ ] **Step 4: Run** → PASS, full worker suite PASS
- [ ] **Step 5: Commit** `feat: limit env api key to bootstrap and compare in constant time`

### Task 5: Audit log middleware and retention

**Files:**
- Create: `packages/db/src/audit-logs.ts` (export from index), `apps/worker/src/middleware/audit.ts`
- Modify: `apps/worker/src/index.ts` (register after `authMiddleware`; call cleanup in `scheduled`), `apps/worker/src/index.ts` `Env['Variables']` gains `accessEmail?: string`
- Test: `packages/db/src/audit-logs.test.ts`, `apps/worker/src/middleware/audit.test.ts`

**Interfaces:**
- Produces: `insertAuditLog(db, entry: { staffId: string; staffName: string; role: string; accessEmail: string | null; method: string; path: string; status: number; ip: string | null }): Promise<void>`; `deleteAuditLogsBefore(db, isoTimestamp: string): Promise<number>`
- Produces: `auditMiddleware` — after `await next()`, if `c.get('staff')` is set and method ∈ {POST, PUT, PATCH, DELETE}, schedules `insertAuditLog` via `c.executionCtx.waitUntil` (fallback: await, swallowing errors) with `path = new URL(c.req.url).pathname`, `ip = c.req.header('CF-Connecting-IP') ?? null`. Insert errors are logged with `console.error('[audit] insert failed')` and never change the response.
- Scheduled: `deleteAuditLogsBefore(db, jst ISO of now − 365 days)`.

- [ ] **Step 1: Write failing tests:**
  - `records authenticated PUT with path and status, no query string` → request `PUT /api/tags/1?token=x` → entry `path === '/api/tags/1'`, `status === 200`
  - `skips GET` and `skips unauthenticated requests`
  - `insert failure does not change the response` → insert throws, response still 200
  - `never stores Authorization or body` → serialized entry contains neither the bearer token nor the request body string
  - db: `deleteAuditLogsBefore binds the cutoff`
- [ ] **Step 2: Run** the two test files → FAIL
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; full worker suite PASS
- [ ] **Step 5: Commit** `feat: audit-log authenticated changes with 365-day retention`

### Task 6: Cloudflare Access JWT enforcement + client.json access block

**Files:**
- Create: `apps/worker/src/middleware/access-jwt.ts`
- Modify: `apps/worker/src/middleware/auth.ts` (call after staff is resolved), `Env['Bindings']` (`ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string`)
- Modify: `scripts/lib/client-config.mjs` (required `access: { teamDomain, aud }`), `scripts/lib/render-wrangler.mjs` (render `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` into `[vars]`), `scripts/lib/test-fixtures.mjs`
- Test: `apps/worker/src/middleware/access-jwt.test.ts`, extend `auth.test.ts`, `scripts/client-config.test.mjs`, `scripts/render-wrangler.test.mjs`

**Interfaces:**
- Produces: `verifyAccessJwt(token: string, opts: { teamDomain: string; aud: string; now?: number; fetchImpl?: typeof fetch }): Promise<{ email: string | null } | null>` — RS256 only; fetches `https://<teamDomain>/cdn-cgi/access/certs` (JWKS `keys`), caches per teamDomain for 10 minutes, on unknown `kid` refetches once; checks `aud` includes opts.aud, `iss === 'https://' + teamDomain`, `exp > now`, `nbf`/`iat` not in the future (60 s skew). Returns null on any failure; never throws.
- `client.json`: `access.teamDomain` matches `/^[a-z0-9-]+\.cloudflareaccess\.com$/`; `access.aud` matches `/^[0-9a-f]{64}$/`.
- auth middleware: after staff (or env owner) is resolved — if both vars set: missing/invalid JWT → 403 `{ success:false, error:'Access verification required' }`; valid → `c.set('accessEmail', email)`. If exactly one set → 500 `{ success:false, error:'Access misconfigured' }`. If neither set → unchanged behavior (dev/local).

- [ ] **Step 1: Write failing tests** (generate an RSA key pair with `crypto.subtle.generateKey` in the test, sign tokens, stub `fetchImpl` returning the JWKS):
  - `accepts a valid token and returns email`
  - `rejects wrong aud`, `rejects wrong iss`, `rejects expired`, `rejects alg none / HS256`
  - `refetches JWKS once on unknown kid then accepts` (second fetch returns rotated key) and `rejects when kid still unknown after refetch` (fetch called exactly 2 times)
  - `returns null when JWKS fetch throws`
  - auth: `403 without Cf-Access-Jwt-Assertion when Access configured`; `public paths stay public when Access configured`; `500 when only ACCESS_AUD set`; `unchanged when Access not configured`
  - scripts: `rejects missing access block`, `rejects bad teamDomain`, `renders ACCESS vars`
- [ ] **Step 2: Run** worker and script tests → FAIL
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:scripts` and `cd apps/worker && npx vitest run && npx tsc --noEmit` → PASS, exit 0
- [ ] **Step 5: Commit** `feat: require cloudflare access jwt for admin api when configured`

### Task 7: Access service-token headers for SDK and MCP

**Files:**
- Modify: `packages/sdk/src/http.ts`, `packages/sdk/src/client.ts` (pass-through config), `packages/mcp-server/src/client.ts`
- Test: `packages/sdk/src/http.test.ts` (new)
- Modify: `docs/ai-line-crm-installation-guide.md` §10 MCP Setup (two new env vars)

**Interfaces:**
- `HttpClientConfig` gains optional `accessClientId?: string; accessClientSecret?: string`; when both set, requests add `CF-Access-Client-Id` and `CF-Access-Client-Secret`.
- MCP reads `LINE_HARNESS_ACCESS_CLIENT_ID` / `LINE_HARNESS_ACCESS_CLIENT_SECRET`.

- [ ] **Step 1: Write failing tests:** `adds access headers when configured`; `omits them when not configured` (stub global fetch, inspect headers)
- [ ] **Step 2: Run** `cd packages/sdk && npx vitest run src/http.test.ts` → FAIL
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm --filter @line-harness/mcp-server build` → exit 0
- [ ] **Step 5: Commit** `feat: send cloudflare access service token from sdk and mcp`

### Task 8: Docs and whole-branch verification

**Files:**
- Modify: `docs/ai-line-crm-production-checklist.md` (new section: Access application on `adminDomain`, service token for MCP, set `access` in client.json, run `POST /api/staff/rehash-keys` once after upgrading, create owner staff then confirm env key stops working)
- Modify: `docs/superpowers/specs/2026-11-26-per-client-deployment-design.md` §5.2 example (add `access` block)

- [ ] **Step 1:** Update docs as listed.
- [ ] **Step 2:** `pnpm test:scripts` → PASS; `cd apps/worker && npx vitest run && npx tsc --noEmit` → PASS; `cd packages/db && npx vitest run`; `cd packages/sdk && npx vitest run` → PASS
- [ ] **Step 3:** Report; do not push, merge or deploy without the user's instruction.
