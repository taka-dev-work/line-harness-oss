# AI Concierge and Security Foundation Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task by task. Every production change must follow `superpowers:test-driven-development`.

**Goal:** Fix the reviewed security and reliability defects, then add an account-scoped LINE AI concierge that calls OpenAI, Anthropic, or Gemini only after a zero-token local relevance gate accepts the message.

**Architecture:** Keep Hono route handlers thin. Put deterministic relevance logic, provider adapters, and orchestration in `apps/worker/src/services/ai-concierge/`; put D1 persistence in `packages/db/src/ai-concierge.ts`. Existing system commands and keyword auto-replies remain ahead of the concierge in the webhook pipeline. API credentials remain Cloudflare Secrets, while per-account service knowledge and provider order live in D1.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers/D1, Vitest, Next.js, React, native `fetch`

## Global Constraints

- An off-topic message must cause exactly zero calls to OpenAI, Anthropic, and Gemini.
- Relevance classification must be deterministic and run inside the Worker without an external API.
- Existing system commands and `auto_replies` must take priority over the concierge.
- All concierge data must be scoped by `line_account_id`.
- AI API keys must only come from Cloudflare Secrets and must never be returned by an API, written to D1, or rendered in the web app.
- Provider order is configurable per LINE account; unavailable or failed providers are skipped in order.
- AI answers may only use registered service information and must not invent prices, terms, or guarantees.
- Apply Unicode NFKC normalization, lowercase Latin text, trim outer whitespace, collapse internal whitespace, and treat punctuation as word boundaries.
- General inquiry words such as `料金` must not establish relevance by themselves.
- Keep the concierge disabled by default after migration.
- Do not add provider SDK packages; use Worker-compatible native `fetch`.
- Do not alter unrelated routes or redesign existing screens.
- Every task starts with a failing focused test, then the smallest production change, then the focused test and relevant typecheck.

---

### Task 1: Lock Public Form Route Boundaries

**Files:**
- Create: `apps/worker/src/middleware/auth.test.ts`
- Modify: `apps/worker/src/middleware/auth.ts`

**Step 1: Write failing authorization-boundary tests**

Build a small Hono app with `authMiddleware` and representative handlers. Assert:

- `GET /api/forms/form-1` is public.
- `POST /api/forms/form-1/submit`, `/partial`, and `/opened` are public.
- `PUT /api/forms/form-1` returns `401` without a bearer token.
- `DELETE /api/forms/form-1` returns `401` without a bearer token.

Use a fake DB binding that returns no staff member.

**Step 2: Run the focused test and confirm RED**

Run: `pnpm --filter worker test -- src/middleware/auth.test.ts`

Expected: the unauthenticated `PUT` and `DELETE` assertions fail because the current path-only exemption accepts every method.

**Step 3: Implement method-aware public route matching**

Refactor the form exemptions in `authMiddleware` so the form definition exemption applies only to `GET`, and the public action exemptions apply only to `POST`.

**Step 4: Run focused verification**

Run:

```bash
pnpm --filter worker test -- src/middleware/auth.test.ts
pnpm --filter worker typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/middleware/auth.ts apps/worker/src/middleware/auth.test.ts
git commit -m "fix: enforce method-aware form authentication"
```

---

### Task 2: Remove Trusted Identity and Control Fields from Public Forms

**Files:**
- Create: `apps/worker/src/routes/forms-security.test.ts`
- Create: `apps/worker/src/services/line-id-token.ts`
- Create: `apps/worker/src/services/line-id-token.test.ts`
- Modify: `apps/worker/src/routes/forms.ts`
- Modify: `apps/worker/src/client/form.ts`
- Modify: `apps/worker/src/index.ts`

**Step 1: Write failing form security tests**

Extract or expose a small pure boundary helper where useful. Cover:

- `_skipWebhook` from public JSON is removed and cannot disable configured webhook validation.
- A submitted `friendId` is not accepted as proof of identity.
- A submitted `lineUserId` is not accepted as proof of identity without a server-verified LIFF identity.
- A valid LIFF ID token is verified against the configured LINE Login channel ID and its `sub` becomes the only trusted LINE user ID.
- A token whose `sub` does not match a supplied `lineUserId` is rejected.
- Unverified submissions can be saved without a friend relation but cannot add tags, enroll scenarios, update friend metadata, or issue affiliate rewards.
- Internal trusted calls can still supply a verified friend ID through a server-only input path.

**Step 2: Run the focused test and confirm RED**

Run: `pnpm --filter worker test -- src/routes/forms-security.test.ts`

Expected: current public body fields are trusted, so at least the identity and `_skipWebhook` cases fail.

**Step 3: Implement a trusted identity boundary**

- Strip `_skipWebhook`, `friendId`, and `lineUserId` from public submission data before side effects.
- Send `liff.getIDToken()` from the LIFF client in an authorization header.
- Verify the ID token server-side against `LINE_LOGIN_CHANNEL_ID`; derive identity only from the verified token `sub`.
- Resolve the friend by that verified LINE user ID. If the token is missing or invalid, treat the submission as anonymous.
- Gate tags, scenarios, metadata updates, reply messages, and rewards behind a verified friend.
- Keep anonymous form data storage working.

**Step 4: Run focused and adjacent tests**

Run:

```bash
pnpm --filter worker test -- src/services/line-id-token.test.ts src/routes/forms-security.test.ts
pnpm --filter worker test
pnpm --filter worker typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/services/line-id-token.ts apps/worker/src/services/line-id-token.test.ts apps/worker/src/routes/forms.ts apps/worker/src/routes/forms-security.test.ts apps/worker/src/client/form.ts apps/worker/src/index.ts
git commit -m "fix: prevent public form identity spoofing"
```

---

### Task 3: Fail Closed on External Webhooks

**Files:**
- Create: `apps/worker/src/services/webhook-auth.ts`
- Create: `apps/worker/src/services/webhook-auth.test.ts`
- Create: `apps/worker/src/routes/external-webhooks.test.ts`
- Modify: `apps/worker/src/routes/webhooks.ts`
- Modify: `apps/worker/src/routes/meet-callback.ts`
- Modify: `apps/worker/src/routes/stripe.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `.env.example`

**Step 1: Write failing signature tests**

Cover:

- Constant-time comparison helper accepts the correct shared secret and rejects missing or wrong values.
- Incoming webhook rejects missing and wrong signatures before `fireEvent`.
- Meet callback rejects missing and wrong `X-Meet-Callback-Secret`.
- Stripe endpoint returns `503` when `STRIPE_WEBHOOK_SECRET` is absent.
- Stripe endpoint rejects an invalid signature.

**Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm --filter worker test -- src/services/webhook-auth.test.ts src/routes/external-webhooks.test.ts
```

Expected: incoming and Meet callbacks currently accept unauthenticated requests, and Stripe currently fails open when its secret is absent.

**Step 3: Implement fail-closed verification**

- Require the stored incoming webhook secret via a documented header and compare in constant time.
- Add `MEET_CALLBACK_SECRET` and `STRIPE_WEBHOOK_SECRET` to `Env['Bindings']`.
- Require `X-Meet-Callback-Secret` for Meet callbacks.
- Return `503` without processing when a required server secret is missing.
- Return `401` or `400` for invalid credentials/signatures without invoking side effects.
- Do not return incoming webhook secrets from list/detail management APIs; return only `hasSecret`.

**Step 4: Run verification**

Run:

```bash
pnpm --filter worker test -- src/services/webhook-auth.test.ts src/routes/external-webhooks.test.ts
pnpm --filter worker test
pnpm --filter worker typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/services/webhook-auth.ts apps/worker/src/services/webhook-auth.test.ts apps/worker/src/routes/external-webhooks.test.ts apps/worker/src/routes/webhooks.ts apps/worker/src/routes/meet-callback.ts apps/worker/src/routes/stripe.ts apps/worker/src/index.ts .env.example
git commit -m "fix: authenticate external webhook callbacks"
```

---

### Task 4: Isolate Broadcast Audiences and Make Queue Progress Idempotent

**Files:**
- Create: `apps/worker/src/services/broadcast.test.ts`
- Modify: `apps/worker/src/services/broadcast.ts`
- Modify: `apps/worker/src/routes/broadcasts.ts`
- Modify: `packages/db/src/broadcasts.ts`
- Modify: `packages/line-sdk/src/client.ts`
- Create: `packages/line-sdk/src/client.test.ts`
- Create: `packages/db/migrations/030_broadcast_delivery_idempotency.sql`
- Modify: `packages/db/schema.sql`

**Step 1: Write failing broadcast tests**

Use fake D1 statements and a fake LINE client. Cover:

- Direct tag broadcasts always include `f.line_account_id = ?`.
- A target from another LINE account is never returned.
- A delivery row has a unique `(broadcast_id, friend_id)` identity.
- Each delivery receives a stable persisted LINE retry key before its first send.
- A restarted job skips targets already marked `sent`.
- A failed or uncertain target is retried with the same LINE retry key, allowing LINE to deduplicate the request.
- The queue offset advances only after durable per-target result recording.

**Step 2: Run the focused test and confirm RED**

Run: `pnpm --filter worker test -- src/services/broadcast.test.ts`

Expected: direct tag selection or crash recovery cases fail with current queue behavior.

**Step 3: Add delivery-level idempotency**

- Add `broadcast_deliveries` with broadcast ID, friend ID, LINE account ID, status, attempt count, timestamps, and last error.
- Store a UUID retry key on each delivery row and create it before sending.
- Add the unique constraint and lookup indexes.
- Materialize or upsert target rows before sending.
- Extend the LINE SDK send method used here to accept `X-Line-Retry-Key`.
- Mark each target `sent` only after LINE accepts it. If the Worker stops after LINE acceptance but before the DB update, retry with the same key so LINE can return the original result without delivering twice.
- On retry, select only pending/failed/uncertain rows according to the retry policy and reuse their stored keys.
- Scope every tag/friend audience query by the broadcast LINE account.

**Step 4: Run focused verification**

Run:

```bash
pnpm --filter worker test -- src/services/broadcast.test.ts
pnpm --filter @line-crm/line-sdk test -- src/client.test.ts
pnpm --filter worker test
pnpm --filter worker typecheck
pnpm --filter @line-crm/db typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/services/broadcast.ts apps/worker/src/services/broadcast.test.ts apps/worker/src/routes/broadcasts.ts packages/db/src/broadcasts.ts packages/line-sdk/src/client.ts packages/line-sdk/src/client.test.ts packages/db/migrations/030_broadcast_delivery_idempotency.sql packages/db/schema.sql
git commit -m "fix: make broadcast delivery account-safe and idempotent"
```

---

### Task 5: Restore Schema and Installer Parity

**Files:**
- Create: `packages/create-line-harness/src/lib/config.test.ts`
- Create: `packages/create-line-harness/src/lib/config.ts` or refactor existing exports there
- Modify: `packages/create-line-harness/src/commands/setup.ts`
- Modify: `packages/create-line-harness/src/commands/update.ts`
- Modify: `packages/create-line-harness/src/steps/deploy-worker.ts`
- Modify: `packages/create-line-harness/package.json`
- Modify: `packages/db/schema.sql`
- Modify: `.gitignore`

**Step 1: Write failing installer configuration tests**

Cover:

- Generated `[assets]` always contains a real `directory`.
- Updating config preserves existing account ID, D1 database ID, worker name, and environment-specific values.
- Persisted setup state does not contain API keys, LINE channel secret, access token, or serialized Wrangler content containing secrets.
- The state file path is ignored by Git.

**Step 2: Add an executable schema-parity check**

Create a test or script that initializes a temporary local D1/SQLite-compatible database from `packages/db/schema.sql` and verifies the columns used by current DB modules, including the latest booking, diagnosis, messaging, account, queue, and concierge-ready baseline tables.

Run the new test and confirm it fails on the missing current columns.

**Step 3: Implement configuration and schema fixes**

- Generate valid Assets configuration with the correct path relative to the generated Worker config.
- Parse/update known TOML values without replacing user-specific values with placeholders.
- Stop persisting `apiKey` and other plaintext secrets in resumable state. Generate or retrieve sensitive values only for the step that consumes them.
- Keep state resumability for non-secret resource IDs.
- Bring `schema.sql` to the same final shape as all migrations through migration 030.

**Step 4: Run verification**

Run:

```bash
pnpm --filter create-line-harness test
pnpm --filter create-line-harness build
pnpm --filter @line-crm/db typecheck
pnpm --filter worker typecheck
```

If `create-line-harness` has no test script before this task, add `"test": "vitest run"` and Vitest as a dev dependency.

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/create-line-harness packages/db/schema.sql .gitignore pnpm-lock.yaml
git commit -m "fix: keep installer configuration and schema in sync"
```

---

### Task 6: Escape Booking HTML

**Files:**
- Create: `apps/worker/src/utils/html.ts`
- Create: `apps/worker/src/utils/html.test.ts`
- Create: `apps/worker/src/routes/booking-page.test.ts`
- Modify: `apps/worker/src/routes/booking.ts`
- Modify: `apps/worker/src/client/booking.ts`

**Step 1: Write failing XSS tests**

Cover text containing `<script>`, quotes, ampersands, and closing tags. Assert that:

- Service name and description are escaped in public booking HTML.
- Booking status and ID are escaped in confirmation HTML.
- Dynamic values inserted into JavaScript use JSON serialization rather than string interpolation.

**Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm --filter worker test -- src/utils/html.test.ts src/routes/booking-page.test.ts
```

Expected: stored service fields appear as executable HTML in current output.

**Step 3: Implement shared escaping**

Move or reuse the client helper as a shared pure utility where practical. Escape HTML text/attribute values and serialize JavaScript string data safely.

**Step 4: Run verification**

Run:

```bash
pnpm --filter worker test -- src/utils/html.test.ts src/routes/booking-page.test.ts
pnpm --filter worker test
pnpm --filter worker typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/utils/html.ts apps/worker/src/utils/html.test.ts apps/worker/src/routes/booking-page.test.ts apps/worker/src/routes/booking.ts apps/worker/src/client/booking.ts
git commit -m "fix: escape dynamic booking page content"
```

---

### Task 7: Add Concierge Persistence

**Files:**
- Create: `packages/db/migrations/031_ai_concierge.sql`
- Create: `packages/db/src/ai-concierge.ts`
- Create: `packages/db/src/ai-concierge.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/schema.sql`

**Step 1: Write failing DB repository tests**

Cover:

- Default settings are disabled.
- Settings upsert and read require a LINE account ID.
- FAQ CRUD cannot cross LINE account boundaries.
- Session upsert uses unique `(line_account_id, friend_id)`.
- Expired sessions are not returned as active.
- Log insertion does not accept API keys or full prompts.

**Step 2: Run focused test and confirm RED**

Run: `pnpm --filter @line-crm/db test -- src/ai-concierge.test.ts`

If the DB package lacks a test script, add Vitest and a focused test script as part of this task.

Expected: repository and tables do not exist.

**Step 3: Add migration and typed repository**

Implement the four tables and indexes from the design:

- `ai_concierge_settings`
- `ai_concierge_faqs`
- `ai_concierge_sessions`
- `ai_concierge_logs`

Use JSON string columns for arrays and bounded recent history. Keep API keys out of all input types.

**Step 4: Run verification**

Run:

```bash
pnpm --filter @line-crm/db test -- src/ai-concierge.test.ts
pnpm --filter @line-crm/db typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/db/migrations/031_ai_concierge.sql packages/db/src/ai-concierge.ts packages/db/src/ai-concierge.test.ts packages/db/src/index.ts packages/db/schema.sql packages/db/package.json pnpm-lock.yaml
git commit -m "feat: add AI concierge persistence"
```

---

### Task 8: Implement the Zero-Token Relevance Gate

**Files:**
- Create: `apps/worker/src/services/ai-concierge/types.ts`
- Create: `apps/worker/src/services/ai-concierge/relevance.ts`
- Create: `apps/worker/src/services/ai-concierge/relevance.test.ts`

**Step 1: Write the relevance test matrix**

Include Japanese and Latin examples:

- Service name exact and partial matches are relevant.
- Registered keyword matches are relevant.
- FAQ question terms can establish relevance.
- `料金はいくら？` alone is off-topic without a service term or active context.
- `それはいくら？` is relevant only with a non-expired relevant session.
- Greetings, weather, politics, homework, and unrelated product questions are off-topic.
- NFKC, Latin case, punctuation, and whitespace variants normalize consistently.
- One-character and configured stop words do not establish relevance.
- The result contains deterministic reason codes for the management test screen.

**Step 2: Run focused test and confirm RED**

Run: `pnpm --filter worker test -- src/services/ai-concierge/relevance.test.ts`

Expected: module does not exist.

**Step 3: Implement the pure gate**

Implement:

- `normalizeForRelevance`
- service-specific token extraction with stop-word filtering
- deterministic scoring
- active-context handling
- `classifyRelevance(input): RelevanceDecision`

Do not import or call any provider code from this module.

**Step 4: Run verification**

Run:

```bash
pnpm --filter worker test -- src/services/ai-concierge/relevance.test.ts
pnpm --filter worker typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/services/ai-concierge/types.ts apps/worker/src/services/ai-concierge/relevance.ts apps/worker/src/services/ai-concierge/relevance.test.ts
git commit -m "feat: add zero-token concierge relevance gate"
```

---

### Task 9: Add Worker-Native OpenAI, Anthropic, and Gemini Adapters

**Files:**
- Create: `apps/worker/src/services/ai-concierge/providers.ts`
- Create: `apps/worker/src/services/ai-concierge/providers.test.ts`
- Modify: `apps/worker/src/services/ai-concierge/types.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `.env.example`
- Modify: `apps/worker/wrangler.toml`

**Step 1: Confirm current official API contracts**

Before coding, verify the current request and response formats using official OpenAI, Anthropic, and Google Gemini documentation. Record only the chosen endpoint, API version/header, response text path, and usage fields in code comments where the format is non-obvious.

**Step 2: Write failing adapter contract tests**

Mock global `fetch` and cover for each provider:

- Correct endpoint, authentication header, model, and JSON body.
- Successful text extraction.
- Input/output token extraction when supplied.
- Missing key produces an unavailable result without `fetch`.
- Timeout, `429`, `5xx`, invalid JSON shape, and empty text become typed provider errors.
- No API key appears in error messages.

**Step 3: Run focused tests and confirm RED**

Run: `pnpm --filter worker test -- src/services/ai-concierge/providers.test.ts`

Expected: adapters do not exist.

**Step 4: Implement native-fetch adapters**

Add `OpenAiProvider`, `AnthropicProvider`, and `GeminiProvider` behind the shared `AiProvider` interface. Add:

- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
- optional `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`

Use bounded timeouts and typed errors. Do not log request headers or full payloads.

**Step 5: Run verification**

Run:

```bash
pnpm --filter worker test -- src/services/ai-concierge/providers.test.ts
pnpm --filter worker typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/worker/src/services/ai-concierge/providers.ts apps/worker/src/services/ai-concierge/providers.test.ts apps/worker/src/services/ai-concierge/types.ts apps/worker/src/index.ts apps/worker/wrangler.toml .env.example
git commit -m "feat: add multi-provider AI adapters"
```

---

### Task 10: Build the Concierge Orchestrator

**Files:**
- Create: `apps/worker/src/services/ai-concierge/prompt.ts`
- Create: `apps/worker/src/services/ai-concierge/orchestrator.ts`
- Create: `apps/worker/src/services/ai-concierge/orchestrator.test.ts`
- Modify: `apps/worker/src/services/ai-concierge/types.ts`

**Step 1: Write failing orchestration tests**

Cover:

- Disabled settings do not classify or call providers.
- Off-topic input returns the configured fixed message and calls all providers zero times.
- Relevant input calls only the first available provider.
- Failure calls the next provider in configured order.
- All failures return the configured provider-error message.
- Prompt contains service name, description, pricing, audience, FAQ, and related URLs.
- Prompt forbids unsupported facts, role changes, and secret disclosure.
- History is capped by message count and total characters.
- Result records provider, model, usage, latency, fallback count, and decision reasons without a full prompt.

**Step 2: Run focused test and confirm RED**

Run: `pnpm --filter worker test -- src/services/ai-concierge/orchestrator.test.ts`

Expected: orchestrator does not exist.

**Step 3: Implement orchestration**

Inject providers and a clock for testability. Run the relevance gate before provider selection. Build the bounded prompt only for relevant input. Continue through the configured provider order on typed retryable failures.

**Step 4: Run verification**

Run:

```bash
pnpm --filter worker test -- src/services/ai-concierge/orchestrator.test.ts
pnpm --filter worker typecheck
```

Expected: PASS and the off-topic test proves zero provider calls.

**Step 5: Commit**

```bash
git add apps/worker/src/services/ai-concierge/prompt.ts apps/worker/src/services/ai-concierge/orchestrator.ts apps/worker/src/services/ai-concierge/orchestrator.test.ts apps/worker/src/services/ai-concierge/types.ts
git commit -m "feat: orchestrate service-only AI responses"
```

---

### Task 11: Add Authenticated Concierge Management APIs

**Files:**
- Create: `apps/worker/src/routes/ai-concierge.ts`
- Create: `apps/worker/src/routes/ai-concierge.test.ts`
- Modify: `apps/worker/src/index.ts`

**Step 1: Write failing route tests**

Cover:

- Settings and FAQ endpoints require authentication.
- Every read/write uses the selected `lineAccountId`.
- Cross-account FAQ update/delete returns `404`.
- Provider order accepts only `openai`, `anthropic`, `gemini`, with no duplicates.
- Service fields, keyword counts, FAQ counts, URLs, context TTL, and history limits are bounded.
- Relevance test returns decision and reasons without calling a provider.
- Logs are paginated and account-scoped.
- Capability response exposes only provider availability booleans, never keys.

**Step 2: Run focused test and confirm RED**

Run: `pnpm --filter worker test -- src/routes/ai-concierge.test.ts`

Expected: route does not exist.

**Step 3: Implement thin validated routes**

Use the DB repository and pure relevance gate. Follow the project’s existing success envelope. Register the route in `index.ts`.

**Step 4: Run verification**

Run:

```bash
pnpm --filter worker test -- src/routes/ai-concierge.test.ts
pnpm --filter worker test
pnpm --filter worker typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/routes/ai-concierge.ts apps/worker/src/routes/ai-concierge.test.ts apps/worker/src/index.ts
git commit -m "feat: add AI concierge management API"
```

---

### Task 12: Integrate the Concierge into the LINE Webhook

**Files:**
- Create: `apps/worker/src/services/ai-concierge/handler.ts`
- Create: `apps/worker/src/services/ai-concierge/handler.test.ts`
- Create: `apps/worker/src/routes/webhook-concierge.test.ts`
- Modify: `apps/worker/src/routes/webhook.ts`

**Step 1: Write failing priority and integration tests**

Cover:

- System command match prevents auto-reply and concierge execution.
- Existing keyword auto-reply match prevents concierge execution.
- Disabled concierge preserves current unmatched-message behavior.
- Enabled concierge receives only unmatched text.
- Off-topic reply uses fixed text and causes zero provider calls.
- Relevant reply uses the selected account’s settings, FAQs, session, and LINE credentials.
- Session becomes active after relevant handling and closes after off-topic handling.
- Duplicate LINE webhook event IDs are not answered twice.
- Long responses are split within LINE text limits.

**Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm --filter worker test -- src/services/ai-concierge/handler.test.ts src/routes/webhook-concierge.test.ts
```

Expected: unmatched text never reaches a concierge.

**Step 3: Implement handler and webhook insertion**

- Keep current command and auto-reply branches unchanged.
- Invoke the handler immediately after no auto-reply match and before the generic event continuation.
- Load account-scoped settings and active session.
- Persist the bounded session and safe log.
- Reply with the account’s resolved LINE client.
- Keep logging failure non-fatal to reply delivery.

**Step 4: Run verification**

Run:

```bash
pnpm --filter worker test -- src/services/ai-concierge/handler.test.ts src/routes/webhook-concierge.test.ts
pnpm --filter worker test
pnpm --filter worker typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/services/ai-concierge/handler.ts apps/worker/src/services/ai-concierge/handler.test.ts apps/worker/src/routes/webhook-concierge.test.ts apps/worker/src/routes/webhook.ts
git commit -m "feat: answer service questions from LINE webhook"
```

---

### Task 13: Add the AI Concierge Management Screen

**Files:**
- Create: `apps/web/src/app/ai-concierge/page.tsx`
- Create: `apps/web/src/components/ai-concierge/concierge-settings.tsx`
- Create: `apps/web/src/components/ai-concierge/faq-editor.tsx`
- Create: `apps/web/src/components/ai-concierge/relevance-tester.tsx`
- Create: `apps/web/src/components/ai-concierge/usage-log.tsx`
- Modify: `apps/web/src/components/layout/sidebar.tsx`
- Modify: `apps/web/src/lib/api.ts`

**Step 1: Add web test support if absent and write failing component tests**

Cover:

- Existing account selection scopes all requests.
- Enable toggle, service fields, keywords, fixed messages, and provider order load and save.
- Provider order is an accessible reorder control or explicit ordered selects.
- FAQ add/edit/delete works without nested cards.
- Relevance tester displays `relevant` or `off_topic` and reason labels.
- Provider availability is shown without an API-key field.
- Loading, save error, empty FAQ, empty logs, and provider unavailable states are visible.

**Step 2: Run focused tests and confirm RED**

Run the new web test command for the concierge components.

Expected: page and components do not exist.

**Step 3: Implement the operational screen**

Follow the existing dashboard layout and account context. Use compact full-width sections, existing controls, Lucide icons already available in the app, and cards only for repeated FAQ/log items. Do not add a marketing hero or explanatory feature copy.

**Step 4: Run verification**

Run:

```bash
pnpm --filter web test
pnpm --filter web build
```

Expected: PASS.

**Step 5: Visual verification**

Start the existing local preview, open `/ai-concierge`, and inspect desktop and mobile widths. Verify:

- No overlapping controls or clipped text.
- Provider controls and FAQ actions remain usable on mobile.
- No API key appears in the DOM or network response.

**Step 6: Commit**

```bash
git add apps/web/src/app/ai-concierge/page.tsx apps/web/src/components/ai-concierge apps/web/src/components/layout/sidebar.tsx apps/web/src/lib/api.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add AI concierge management screen"
```

---

### Task 14: Document Configuration and Complete End-to-End Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/.env.example`
- Create: `docs/wiki/26-AI-Concierge.md`
- Modify: `docs/wiki/Home.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/CHANGELOG.md`

**Step 1: Document operator setup**

Document:

- The three Cloudflare Secret names.
- Optional model environment variables.
- D1 migration application.
- Service knowledge setup.
- Provider priority and fallback.
- The zero-token off-topic guarantee and its deterministic limitations.
- Safe rollout with concierge disabled by default.
- Incoming, Meet, and Stripe webhook secret requirements.

Do not include real keys or secret-shaped examples.

**Step 2: Run all verification**

Run:

```bash
pnpm --filter worker test
pnpm --filter worker typecheck
pnpm --filter @line-crm/db typecheck
pnpm --filter create-line-harness test
pnpm --filter create-line-harness build
pnpm --filter web test
pnpm --filter web build
pnpm -r build
git diff --check
```

Expected: all commands exit `0`. If Wrangler emits only its known log-file permission warning after a successful build, record it separately and confirm the build exit code.

**Step 3: Run security acceptance checks**

Confirm from focused test output:

- Public form `PUT` and `DELETE` return `401`.
- Spoofed form identity cannot trigger side effects.
- Missing external webhook secrets fail closed.
- Cross-account tag recipients are excluded.
- Replayed queue work does not duplicate successful deliveries.
- Stored booking HTML is escaped.
- Off-topic concierge input causes exactly zero provider calls.

**Step 4: Run a local smoke test**

Use fake provider responses and a test LINE account:

- Save service knowledge and FAQ.
- Confirm an unrelated question receives the fixed response.
- Confirm a related question reaches the primary provider.
- Force a primary-provider timeout and confirm fallback.
- Confirm logs show safe metadata only.

**Step 5: Commit**

```bash
git add README.md docs
git commit -m "docs: explain secure AI concierge operation"
```

---

## Completion Criteria

- All 14 task commits have scoped tests and task reviews.
- A final whole-branch review finds no unresolved Critical or Important issues.
- The complete verification matrix passes.
- The deployed feature remains disabled until secrets, service knowledge, and relevance examples are configured.
