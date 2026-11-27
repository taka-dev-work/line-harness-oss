# Ops Repo and Approval-Gated Deploy (Plan 2 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private ops repo whose manually triggered, per-client, approval-gated GitHub Actions workflow deploys exactly the pinned release of the product repo to one client's Cloudflare account — refusing when the release, the D1 state or the tests are not right.

**Architecture:** Decisions that need tests live in the product repo as small CLIs (`verify-release`, `predeploy-check`, `d1-bookmark`), so they are unit-tested and versioned with the release they guard. The ops repo stays thin: `clients/<slug>/client.json`, a `deploy.yml` that calls those CLIs in a fixed order, a `validate.yml` for pull requests, and a `node:test` suite that pins the workflow's security properties. The ops repo is built locally in `~/dev/ai-line-crm-ops`; publishing it to the NIBEL org is a human step.

**Tech Stack:** GitHub Actions (`workflow_dispatch`, Environments), Node 22, pnpm 9.15.4, wrangler 4, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-26-per-client-deployment-design.md` §2, §3 (G2, G3, anti-goals), §5.1–§5.4, §9

## Global Constraints

- One credential per client: the only secret the workflow reads is the Environment secret `CLOUDFLARE_API_TOKEN` of `client-<slug>`. No org- or repo-level Cloudflare secret.
- App secrets (LINE / AI / Stripe / Google) are never read, written or listed by the workflow (spec §5.3 step 7).
- Only the release in `client.json` is deployed: checkout by `release.commit`; the tag `release.tag` must resolve to that commit (anti-goal: unreleased main reaching production).
- Third-party actions pinned by full commit SHA: `actions/checkout` v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, `pnpm/action-setup` v6.1.1 `73e46992e05b19abd31f2f3c20e0e7370d762115`, `actions/setup-node` v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1`.
- Workflow `permissions: contents: read` at top level; no job widens it.
- `inputs.*` never appears inside a `run:` script; inputs reach shell only through `env:`.
- No automatic rollback; on failure the job prints the rollback steps and the D1 bookmark (spec §5.3 step 9).
- Node 22, `pnpm install --frozen-lockfile`. No new npm dependencies in either repo.

## Review Focus

1. A client slug crafted to escape (`acme/../other`, `acme;rm`, uppercase) → rejected before any checkout or environment is used. (Task 4)
2. `client.json` points `release.tag` at a different commit than `release.commit`, or the tag is missing → deploy stops before install. (Task 1, Task 4)
3. D1 that predates tracked migrations (client 0 today) reaches the workflow → stops with a pointer to the adoption runbook; never runs `migrations apply` on it. (Task 2)
4. Time Travel bookmark cannot be read → deploy stops before migrations (no restore point, no write). (Task 3, Task 4)
5. The LINE webhook answers 200 even for a bad signature (by design, `routes/webhook.ts`), so spec §5.3 step 8's "webhook rejects unsigned" is **not** observable from outside; the smoke test keeps its 4 checks and this plan does not add a check that would always pass. (ruling recorded here)

---

## Product repo (`~/ai-line-architect`, branch `feature/ops-deploy`)

### Task 1: `verify-release`

**Files:** Create `scripts/lib/release.mjs`, `scripts/verify-release.mjs`; Test `scripts/release.test.mjs`

**Interfaces:**
- `checkRelease({ release: {tag, commit}, tagCommit: string|null, headCommit: string }): { ok: boolean, errors: string[] }`
- CLI: `node scripts/verify-release.mjs --client <client.json>` — validates the config, runs `git rev-parse --verify --quiet <tag>^{commit}` and `git rev-parse HEAD` in the repo root, exits 1 with each error on its own line.

- [ ] **Step 1: Failing tests:** ok when tagCommit === headCommit === release.commit; error `tag <t> not found` when tagCommit null; error `tag <t> points to <x>, client.json pins <y>`; error `checked-out HEAD <h> is not release.commit <y>`; CLI on a temp git repo (init, commit, tag) exits 0 for the right tag and 1 for a moved tag.
- [ ] **Step 2: Run** `node --test scripts/release.test.mjs` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:scripts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: verify the checked-out release matches client.json`

### Task 2: `predeploy-check`

**Files:** Create `scripts/lib/predeploy.mjs`, `scripts/predeploy-check.mjs`; Modify `package.json` (`"db:predeploy:client": "node scripts/predeploy-check.mjs --client \"$CLIENT_CONFIG\""`); Test `scripts/predeploy.test.mjs`

**Interfaces:**
- Consumes: `remoteTableColumns`, `TABLES_QUERY`, `parseWranglerJson`, `remoteQueryArgs`, `diffSchemas`, `tableColumns`, `EXPECTED_SCHEMA_FILE` (schema-drift), `isAdopted` (adopt-legacy-d1), `clientWranglerRunner` (client-runner).
- `classifyD1({ tables: string[], applied: string[], diff: {missingTables, missingColumns} }): { state: 'empty'|'legacy'|'adopted', ok: boolean, message: string }`
  - `empty`: no user tables (ignore `_cf_*`, `sqlite_*`, `d1_migrations`) → ok
  - `legacy`: user tables exist and `!isAdopted(applied)` → not ok, message names `docs/runbooks/client-0-adoption.md`
  - `adopted` with missing baseline tables/columns → not ok, lists them
  - `adopted` and no drift → ok
- CLI: read-only; exits 0 when ok, 1 otherwise; prints `state: <state>`.

- [ ] **Step 1: Failing tests** for the four outcomes above, plus: a db with only `_cf_KV` and an empty `d1_migrations` is `empty`; a legacy db whose `d1_migrations` exists but is empty (left by a failed `migrations apply`) is `legacy`.
- [ ] **Step 2: Run** `node --test scripts/predeploy.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:scripts` — Expected: PASS.
- [ ] **Step 5: Read-only check against production:** `CLIENT_CONFIG=<scratch>/client0-check.json pnpm db:predeploy:client` — Expected: exit 1, `state: legacy`.
- [ ] **Step 6: Commit** `feat: refuse to migrate a d1 that is legacy or drifted`

### Task 3: `d1-bookmark`

**Files:** Create `scripts/d1-bookmark.mjs`; Modify `scripts/lib/client-runner.mjs` only if needed; Test `scripts/d1-bookmark.test.mjs`

**Interfaces:**
- `parseBookmark(stdout: string): string` — from `wrangler d1 time-travel info <db> --json` (`{"bookmark":"…"}`); throws on missing/empty bookmark or wrangler error object.
- CLI: `node scripts/d1-bookmark.mjs --client <client.json>` — prints `bookmark=<value>`; when `GITHUB_OUTPUT` is set, appends `bookmark=<value>` to that file; exits 1 if no bookmark.

- [ ] **Step 1: Failing tests:** parses `{"bookmark":"00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683"}`; throws on `{}` and on `{"bookmark":""}`; surfaces `{"error":{…}}` text; CLI with `GITHUB_OUTPUT` set is covered by a test of an exported `appendOutput(file, key, value)`.
- [ ] **Step 2: Run** `node --test scripts/d1-bookmark.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:scripts` — Expected: PASS.
- [ ] **Step 5: Read-only check against production:** CLI prints `bookmark=` with a non-empty value (do not paste the value into chat or docs).
- [ ] **Step 6: Commit** `feat: record a d1 time-travel bookmark before migrations`

## Ops repo (`~/dev/ai-line-crm-ops`, new; `git init`, branch `main`)

### Task 4: Workflows and their security tests

**Files:**
- Create: `.github/workflows/deploy.yml`, `.github/workflows/validate.yml`, `clients/README.md`, `clients/archive/.gitkeep`, `.gitignore`, `package.json` (`{"private":true,"type":"module","scripts":{"test":"node --test 'tests/**/*.test.mjs'"}}`)
- Test: `tests/workflows.test.mjs`

**deploy.yml** (`workflow_dispatch`, input `client` string required):
- top-level `permissions: contents: read`; `concurrency: { group: deploy-${{ inputs.client }}, cancel-in-progress: false }`
- job `prepare` (no environment): checkout ops repo; step with `env: CLIENT: ${{ inputs.client }}` validates `^[a-z][a-z0-9-]{1,30}$` and `clients/$CLIENT/client.json` exists; outputs `commit`, `tag`, `custom_domain` read with `node -e` from that file.
- job `deploy` (`needs: prepare`, `environment: client-${{ inputs.client }}`, `timeout-minutes: 30`), steps in this order:
  1. checkout ops repo to `ops/`; checkout `${{ vars.PRODUCT_REPOSITORY }}` at `needs.prepare.outputs.commit` to `product/` with `fetch-depth: 0`
  2. pnpm + node 22 (pinned SHAs), `pnpm install --frozen-lockfile`
  3. `node scripts/verify-release.mjs --client ../ops/clients/$CLIENT/client.json`
  4. build packages, `pnpm test:scripts`, worker test + typecheck, db test, sdk test
  5. `pnpm db:predeploy:client` (token in step `env:`)
  6. `node scripts/d1-bookmark.mjs --client …` (id `bookmark`), echo to `$GITHUB_STEP_SUMMARY`
  7. `pnpm db:migrate:client`
  8. `pnpm deploy:client`
  9. `node scripts/smoke-test.mjs --base-url https://<custom_domain>`
  10. `if: failure()` — print rollback steps with the bookmark (no commands that write)
- `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}` appears only in steps 5–8 `env:`; `CLIENT_CONFIG` set from the validated path.

**validate.yml** (`pull_request` on `clients/**`): no secrets, no environment; checkout ops + product (`main`), validate every `clients/*/client.json` (not `archive/`) with the product's `scripts/render-wrangler-config.mjs --out /dev/null`.

- [ ] **Step 1: Failing tests** (`tests/workflows.test.mjs`, plain text parsing, no YAML dependency):
  - both workflows: top-level `permissions:` block is exactly `contents: read`; no `write` anywhere
  - every `uses:` is `<owner>/<repo>@<40 hex>` and matches the three pinned SHAs
  - no `${{ inputs.` inside any `run:` block
  - `secrets.` appears only as `secrets.CLOUDFLARE_API_TOKEN`, only in deploy.yml, and only in steps after `verify-release`
  - deploy.yml step order: `verify-release` < `test:scripts` < `db:predeploy:client` < `d1-bookmark` < `db:migrate:client` < `deploy:client` < `smoke-test`
  - deploy job has `environment: client-${{ inputs.client }}` and `needs: prepare`; prepare job has no `environment:`
  - the slug regex in the prepare step is exactly `^[a-z][a-z0-9-]{1,30}$` (same as product `client-config.mjs`)
  - validate.yml has no `secrets.` and no `environment:`
- [ ] **Step 2: Run** `npm test` in the ops repo — Expected: FAIL (no workflows).
- [ ] **Step 3: Write the workflows.**
- [ ] **Step 4: Run** `npm test` — Expected: PASS. Also run the prepare step's validation snippet locally with `acme`, `acme/../x`, `Acme`, `acme;rm` — Expected: only `acme` (with a fixture file) passes.
- [ ] **Step 5: Commit** `feat: add approval-gated per-client deploy workflow`

### Task 5: Ops README (setup that only a human can do)

**Files:** Create `README.md`; Test: extend `tests/workflows.test.mjs` with "README names every Environment setting the workflow relies on" (`client-<slug>`, `CLOUDFLARE_API_TOKEN`, `PRODUCT_REPOSITORY`, required reviewer, deployment branch `main`).

Content: org prerequisites (Team plan, org-wide 2FA, repo private), repo variable `PRODUCT_REPOSITORY`, per-client Environment (required reviewer, prevent self-review note for one-person operation, deployment branches = `main` only, secret `CLOUDFLARE_API_TOKEN` with the spec §5.4 scopes and 180-day expiry), release process (tag `vX.Y.Z-nibel.N` in the product repo, then PR bumping `release` in `client.json`), how to run a deploy, how to read the bookmark, rollback, and links to the product runbooks.

- [ ] **Step 1–4:** failing README test → write README → `npm test` PASS → commit `docs: document ops repo setup, release and rollback`

### Task 6: Verification and handoff (no outward actions)

- [ ] Product repo: all suites pass (`pnpm test:scripts`, worker test + typecheck, db, sdk).
- [ ] Ops repo: `npm test` passes; `git status` clean; no `client.json` committed for client 0 (its domain is undecided; `client.json` validation requires it).
- [ ] List the human steps that remain, in order: create the private repo in the NIBEL org and push; set `PRODUCT_REPOSITORY`; cut and push the first release tag `v0.13.1-nibel.1` in the product repo; add client 0's `client.json` once the domain is decided; create Environment `client-client0` with reviewer and token; run the adoption runbook, then the first deploy. **None of these are executed by this plan.**
