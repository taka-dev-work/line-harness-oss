# AI LINE CRM Installation Guide

This guide explains how to reuse this repository as an AI LINE CRM starter for another project.

## What You Get

- LINE Official Account CRM
- Friend and chat management
- Rich menu auto replies
- AI diagnosis
- PDF guide delivery
- Booking pages for consultation, course, and workshop
- Google Calendar / Google Meet booking integration
- Customer analysis and hot-lead management
- MCP server for Codex / Claude Code / Cursor workflows

## Requirements

- Node.js 22+
- pnpm
- Cloudflare account
- LINE Official Account
- LINE Developers Messaging API channel
- Optional: LINE Login channel and LIFF app
- Optional: Google Cloud Service Account for Calendar / Meet
- Optional: Gemini API key for AI diagnosis setup

## 1. Clone The Repository

```bash
git clone https://github.com/YOUR_ORG/YOUR_REPO.git
cd YOUR_REPO
pnpm install
```

For a fresh GitHub project, use this repo as a template or fork it first.

## 2. Copy Environment Templates

```bash
cp .env.example .env.local
cp .mcp.example.json .mcp.json
cp config/ai-line-crm.urls.production.example.json config/ai-line-crm.urls.production.json
```

Do not commit these files:

- `.env.local`
- `.mcp.json`
- `config/ai-line-crm.urls.production.json`
- `apps/worker/.dev.vars`

They contain secrets or project-specific URLs.

## 3. Local Development

Create local Worker secrets:

```bash
touch apps/worker/.dev.vars
```

Example:

```env
API_KEY=your-local-admin-key
LINE_CHANNEL_ACCESS_TOKEN=your-line-channel-access-token
LINE_CHANNEL_SECRET=your-line-channel-secret
LINE_LOGIN_CHANNEL_ID=your-line-login-channel-id
LINE_LOGIN_CHANNEL_SECRET=your-line-login-channel-secret
WORKER_URL=http://localhost:5174
LIFF_URL=https://liff.line.me/your-liff-id
GEMINI_API_KEY=your-gemini-api-key
```

Start the apps:

```bash
pnpm dev:worker
pnpm dev:web
```

Open:

```text
http://localhost:3001/login
```

Use the value of `API_KEY` to log in.

## 4. Cloudflare Setup

Login:

```bash
pnpm exec wrangler login
```

Create a D1 database:

```bash
pnpm exec wrangler d1 create line-crm
```

Put the returned `database_id` into:

```text
apps/worker/wrangler.toml
```

Under:

```toml
[[env.production.d1_databases]]
database_name = "line-crm"
database_id = "YOUR_D1_DATABASE_ID"
```

Apply schema/migrations:

```bash
pnpm db:migrate
```

## 5. Production Secrets

Set these in Cloudflare Workers:

```bash
pnpm exec wrangler secret put API_KEY --config apps/worker/wrangler.toml --env production
pnpm exec wrangler secret put LINE_CHANNEL_ACCESS_TOKEN --config apps/worker/wrangler.toml --env production
pnpm exec wrangler secret put LINE_CHANNEL_SECRET --config apps/worker/wrangler.toml --env production
pnpm exec wrangler secret put LINE_LOGIN_CHANNEL_ID --config apps/worker/wrangler.toml --env production
pnpm exec wrangler secret put LINE_LOGIN_CHANNEL_SECRET --config apps/worker/wrangler.toml --env production
pnpm exec wrangler secret put WORKER_URL --config apps/worker/wrangler.toml --env production
pnpm exec wrangler secret put LIFF_URL --config apps/worker/wrangler.toml --env production
pnpm exec wrangler secret put GEMINI_API_KEY --config apps/worker/wrangler.toml --env production
```

Optional Google Calendar / Meet:

```bash
pnpm exec wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL --config apps/worker/wrangler.toml --env production
pnpm exec wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY --config apps/worker/wrangler.toml --env production
pnpm exec wrangler secret put GOOGLE_CALENDAR_ID --config apps/worker/wrangler.toml --env production
```

Check:

```bash
pnpm exec wrangler secret list --config apps/worker/wrangler.toml --env production
```

## 6. Deploy

```bash
pnpm deploy:worker:production
```

Your app will be available at:

```text
https://YOUR_WORKER_NAME.YOUR_ACCOUNT.workers.dev
```

## 7. LINE Developers Setup

In LINE Developers:

1. Open the Messaging API channel
2. Set webhook URL:

```text
https://YOUR_WORKER_DOMAIN/webhook
```

3. Enable webhook
4. Verify webhook
5. Disable LINE Official Account Manager auto-response if it conflicts with this app

## 8. Seed AI LINE CRM Content

Edit:

```text
config/ai-line-crm.urls.production.json
```

Then seed:

```bash
pnpm crm:seed:ai-line -- --url-config=config/ai-line-crm.urls.production.json --strict-urls
```

Optional rich menu export:

```bash
pnpm crm:rich-menu:ai-line
```

## 9. Google Calendar / Meet Setup

1. Create a Google Cloud project
2. Enable Google Calendar API
3. Create a Service Account
4. Create a JSON key
5. Copy:

```text
client_email -> GOOGLE_SERVICE_ACCOUNT_EMAIL
private_key  -> GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
```

6. Share the target Google Calendar with the Service Account email
7. Give permission:

```text
Make changes to events
```

8. Copy the Calendar ID:

```text
GOOGLE_CALENDAR_ID
```

Then enable Google Meet from the Booking page in the admin dashboard.

## 10. MCP Setup For Codex / Claude Code

Copy:

```bash
cp .mcp.example.json .mcp.json
```

Edit `.mcp.json`:

```json
{
  "mcpServers": {
    "ai-line-crm": {
      "command": "node",
      "args": ["packages/mcp-server/dist/index.js"],
      "env": {
        "LINE_HARNESS_API_URL": "https://YOUR_WORKER_DOMAIN",
        "LINE_HARNESS_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

Build the MCP server:

```bash
pnpm --filter @line-harness/mcp-server build
```

Restart Codex / Claude Code / Cursor so it reads `.mcp.json`.

Test prompts:

```text
manage_bookingsで予約サービス一覧を取得して
analyze_customersでLINE顧客を分析して
```

## 11. Codex / Claude Code Bootstrap Prompt

Use this prompt after cloning the repo:

```text
このリポジトリはAI LINE CRMです。
READMEとdocs/ai-line-crm-installation-guide.mdを読み、ローカル開発環境を構築してください。
次に、Cloudflare Workers/D1、LINE Developers、Google Calendar、MCP連携に必要な未設定項目をチェックリスト化してください。
秘密情報は表示せず、設定が必要な変数名だけを案内してください。
```

## 12. Production Checklist

- [ ] D1 database created
- [ ] `wrangler.toml` production database_id set
- [ ] Worker secrets set
- [ ] Production deploy successful
- [ ] LINE webhook verified
- [ ] Admin dashboard login works
- [ ] Friend add event appears in dashboard
- [ ] Rich menu replies work
- [ ] AI diagnosis works
- [ ] Booking form submission works
- [ ] Google Calendar event is created
- [ ] Google Meet URL appears in LINE message
- [ ] MCP `manage_bookings` works
- [ ] MCP `analyze_customers` works

