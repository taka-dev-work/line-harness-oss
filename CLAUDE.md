# Claude Code Guide

This repository can be reused as an AI LINE CRM starter.

Before changing code, read these files:

1. `README.md`
2. `docs/ai-line-crm-installation-guide.md`
3. `AGENTS.md`

## Setup Goal

Help the user clone this project, configure local development, deploy it to Cloudflare Workers + D1, connect a LINE Official Account, and optionally connect Google Calendar / Meet and MCP.

## Important Rules

- Do not print secret values.
- Do not commit `.env.local`, `.mcp.json`, `apps/worker/.dev.vars`, or `config/*.production.json`.
- Use `pnpm` commands from `package.json`.
- Prefer small, verifiable steps.
- When setup fails, explain the missing variable or external setting clearly.

## Useful Commands

```bash
pnpm install
pnpm dev:worker
pnpm dev:web
CLIENT_CONFIG=path/to/client.json pnpm db:migrate:client
CLIENT_CONFIG=path/to/client.json pnpm deploy:client
pnpm crm:seed:ai-line -- --url-config=config/ai-line-crm.urls.production.json --strict-urls
pnpm --filter @line-harness/mcp-server build
```

## Bootstrap Prompt

```text
このリポジトリはAI LINE CRMです。
READMEとdocs/ai-line-crm-installation-guide.mdを読み、ローカル開発環境を構築してください。
次に、Cloudflare Workers/D1、LINE Developers、Google Calendar、MCP連携に必要な未設定項目をチェックリスト化してください。
秘密情報は表示せず、設定が必要な変数名だけを案内してください。
```
