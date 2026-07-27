# Changelog

## Unreleased (2026-07-27)

### New Features
- LINEアカウント別AIコンシェルジュを追加
- OpenAI、Anthropic、Geminiの優先順位設定と自動フォールバックを追加
- サービス情報、FAQ、関連性テスト、安全な利用ログを管理する画面を追加
- 無関係な質問をWorker内で終了し、AIプロバイダーを呼び出さないローカル判定を追加

### Security
- 公開フォームの更新・削除を管理者認証で保護
- 外部Webhook、Meet callback、Stripe webhookをSecret未設定時に閉鎖
- クロスアカウント配信、キュー再実行、保存済み予約HTMLの安全性を強化
- AIログからメッセージ本文、プロンプト、秘密情報を除外

## v0.2.0 (2026-03-25)

### Breaking Changes
- **DB Schema**: `line_account_id` column added to `friends`, `scenarios`, `broadcasts`, `reminders`, `automations`, `chats`
- **DB Schema**: `login_channel_id`, `login_channel_secret`, `liff_id` columns added to `line_accounts`
- **Timestamps**: All timestamps standardized to JST (+09:00). Existing UTC data is compatible via epoch comparison.

### Upgrade
```bash
wrangler d1 execute line-crm --file=packages/db/migrations/008_multi_account.sql --remote
```

### New Features
- **Multi-account support** — Webhook routing, cron delivery, and admin UI per LINE account
- **Account switcher UI** — Global dropdown in sidebar, all pages filter by selected account
- **Cross-provider UUID linking** — `?uid=` param in `/auth/line` for automatic identity linking across providers
- **Template variable expansion** — `{{name}}`, `{{uid}}`, `{{auth_url:CHANNEL_ID}}` in scenario messages
- **Delivery window** — 9:00-23:00 JST enforcement, per-user preferred hour via "配信時間はN時"
- **replyMessage for welcome** — First step (delay=0) uses free replyMessage instead of pushMessage
- **Bot profile in admin** — Account cards show LINE profile picture, display name, basic ID
- **Account stats** — Per-account friend count, active scenarios, monthly message count
- **GitHub Actions CI/CD** — Auto-deploy Worker on push to main
- **OAuth direct redirect** — `/auth/line` redirects to LINE Login OAuth directly (no LIFF needed)
- **Friend-add redirect** — After OAuth callback, auto-redirect to `line.me/R/ti/p/{basicId}`

### Bug Fixes
- JST timestamp standardization (was UTC, causing wrong delivery times)
- Auth unification (affiliates page + login fallback URL)
- Calendar slot time calculation (was offset by 9 hours)
- ID token verification using correct login channel for multi-account

## v0.1.0 (2026-03-22)

### Initial Release
- Step delivery (scenarios with delay_minutes timing)
- Broadcasts (scheduled, segmented, batch sending)
- Tag-based segmentation
- Rich menu management
- Forms & LIFF
- Tracked links
- Reminders
- Lead scoring
- IF-THEN automation engine
- Webhooks (incoming/outgoing) + notifications
- Operator chat + auto-reply
- Conversion tracking + affiliate system
- Multi-account tables (line_accounts)
- TypeScript SDK (41 tests)
- OpenAPI/Swagger docs
- Admin panel (Next.js 15)
