# クライアント0号（既存本番）の移行

マイグレーション管理（`d1-migrations` + `d1_migrations` テーブル）より前に作った D1 を、新しい配信方式へ移す手順です。最初の対象は既存本番（設計書 §8.1）。

## 現状（2026-11-26 の読み取り専用チェック）

- `d1_migrations` テーブルがない。初期スキーマ（`0000_baseline.sql`）より**遅れている**：テーブル3つ（`broadcast_deliveries`, `form_opens`, `traffic_pools`）と列9つが不足
- そのまま `pnpm db:migrate:client` を実行すると `0000_baseline.sql` の途中で失敗する（`no such column: broadcast_delivery_id`）。失敗しても空の `d1_migrations` テーブルが残るだけで、データは変わらない
- 実在の友だち・予約・フォーム回答がある。スタッフは0人（`API_KEY` だけで運用中）
- 公開 URL は `*.workers.dev` だけ。新方式は `workers_dev = false` なので、**デプロイした瞬間に旧 URL は止まる**

## 開始条件

- [ ] `customDomain` / `adminDomain` が決まり、本番アカウントの Cloudflare で管理されている
- [ ] Cloudflare Access のアプリを `adminDomain` に作り、`client.json` の `access` を埋めた（[本番チェックリスト §5a](../ai-line-crm-production-checklist.md)）
- [ ] 運用リポジトリと承認付きデプロイ（計画2）が使える。`client.json` は運用リポジトリにある
- [ ] LINE の Webhook を止めてよい時間帯を決めた（数分）

## 手順

### 1. 戻せる地点を作る

```bash
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- d1 time-travel info <d1DatabaseName>
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- d1 export <d1DatabaseName> --remote --output <暗号化した保存先>/client0-before-adoption.sql
```

表示されたブックマークを記録する。エクスポートは個人情報を含むので、暗号化した場所に置く。

### 2. 差分を確認し、移行 SQL を作る（読み取りのみ）

```bash
pnpm db:drift:client
pnpm db:adopt:client -- --out client0-adopt.sql
```

`3 tables, 9 columns` と出ること。生成された SQL を読み、`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN` / `CREATE INDEX IF NOT EXISTS` / `d1_migrations` への記録だけであることを確認する。

### 3. 適用する（本番への書き込み。承認を取ってから）

```bash
pnpm db:adopt:client -- --out client0-adopt.sql --apply --export-file <手順1のエクスポート> --bookmark <手順1のブックマーク> --confirm <d1DatabaseName>
```

`OK: schema matches 0000_baseline.sql` で終わること。途中で失敗したら、**同じコマンドをもう一度**実行する（その時点で足りないものだけを作り直す）。

### 4. 以降のマイグレーションを当てる

```bash
pnpm db:migrate:client
pnpm db:drift:client
```

`0001_auth_hardening.sql` が適用され、差分チェックが `OK` になること。

### 5. デプロイと LINE 側の切り替え（ここで旧 URL が止まる）

1. 運用リポジトリのデプロイワークフローで client-0 をデプロイする
2. すぐに LINE Developers で Webhook URL を `https://<customDomain>/webhook` に変更し「検証」
3. LIFF のエンドポイント URL、LINE Login のコールバック URL を `customDomain` に変更
4. `node scripts/smoke-test.mjs --base-url https://<customDomain>`

### 6. 管理者の切り替え

[本番チェックリスト §5b](../ai-line-crm-production-checklist.md) の通り、`API_KEY` でオーナーを2人作り、`API_KEY` が `401` になることを確認する。最後に [LINE 実機確認チェックリスト](../ai-line-crm-line-test-checklist.md) を通す。

## 戻し方

| どこで失敗したか | 戻し方 |
|---|---|
| 手順3〜4 | 旧バージョンのコードは追加された列・テーブルを使わないので、**そのまま動き続ける**。原因を直して手順3から再実行。どうしても戻すなら `d1 time-travel restore <d1DatabaseName> --bookmark=<ブックマーク>`（以降の書き込みは消える） |
| 手順5 | 新方式の設定は `workers.dev` を出さないため、旧 URL への即時の戻しはできない。新しいドメインで不具合を直すのが基本。旧 URL に戻す必要があるときは、旧リリースを `workers_dev = true` の一時設定で手動デプロイする例外手順になる（小林さんの承認が必要） |

既存 D1 の差分チェックの限界は [legacy-d1-notes.md](./legacy-d1-notes.md) を参照。
