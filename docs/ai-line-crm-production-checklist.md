# AI LINE CRM 本番化チェックリスト

このチェックリストは、ローカル検証済みのAI LINE CRMを本番運用へ移すための最短手順です。

## 1. 固定URLを決める

Cloudflare Tunnel の一時URLではなく、Cloudflare Workers の固定URLまたは独自ドメインを使います。

```text
https://YOUR_WORKER_DOMAIN
```

LINE Developers の Webhook URL は一度決めたら変更しません。

```text
https://YOUR_WORKER_DOMAIN/webhook
```

## 2. 本番URL設定を作る

```bash
cp config/ai-line-crm.urls.production.example.json config/ai-line-crm.urls.production.json
```

`YOUR_WORKER_DOMAIN` を固定URLへ置換します。

```bash
pnpm crm:validate:ai-line -- --url-config=config/ai-line-crm.urls.production.json --strict-urls
pnpm crm:check:ai-line -- --url-config=config/ai-line-crm.urls.production.json --production
```

## 3. Cloudflare secrets を設定する

Worker本番環境に以下を設定します。

```bash
node scripts/with-client.mjs --client path/to/client.json -- secret put API_KEY
node scripts/with-client.mjs --client path/to/client.json -- secret put LINE_CHANNEL_ACCESS_TOKEN
node scripts/with-client.mjs --client path/to/client.json -- secret put LINE_CHANNEL_SECRET
node scripts/with-client.mjs --client path/to/client.json -- secret put LINE_LOGIN_CHANNEL_ID
node scripts/with-client.mjs --client path/to/client.json -- secret put LINE_LOGIN_CHANNEL_SECRET
node scripts/with-client.mjs --client path/to/client.json -- secret put WORKER_URL
node scripts/with-client.mjs --client path/to/client.json -- secret put LIFF_URL
```

`WORKER_URL` は固定Worker URL、`LIFF_URL` はLIFFのエンドポイントまたはWorker固定URLを設定します。

## 4. D1を本番へ反映する

クライアントの `client.json` に本番D1の `d1DatabaseId` を書きます。wrangler の設定は各コマンドの実行時に `client.json` から毎回生成されます（前回の生成物は再利用しません）。

既存のD1（以前のバージョンで作成したもの）に適用する場合は、**必ず先に**スキーマの差分を確認します。
`DRIFT` と表示されたら移行を止め、不足している列を手作業で補ってから再確認してください
（初期スキーマは既存テーブルに列を追加しないため、そのまま適用すると不足が残ったまま「適用済み」と記録されます）。

```bash
CLIENT_CONFIG=path/to/client.json pnpm db:drift:client
```

差分がない（`OK`）ことを確認してから適用します。

```bash
CLIENT_CONFIG=path/to/client.json pnpm db:migrate:client
```

## 5. Workerをデプロイする

```bash
CLIENT_CONFIG=path/to/client.json pnpm deploy:client
```

## 6. CRM初期データを投入する

```bash
LINE_HARNESS_API_URL=https://YOUR_WORKER_DOMAIN \
LINE_HARNESS_API_KEY=YOUR_API_KEY \
pnpm crm:seed:ai-line -- --url-config=config/ai-line-crm.urls.production.json --strict-urls
```

## 7. リッチメニューを本番作成する

```bash
pnpm crm:rich-menu:ai-line -- --url-config=config/ai-line-crm.urls.production.json --out=generated/ai-line-rich-menu.production.json
```

作成、画像アップロード、デフォルト設定を本番APIへ実行します。

## 8. 実機確認

- LINE Developers の Webhook 検証が OK
- 友だち追加で初回メッセージが届く
- リッチメニュー6項目が反応する
- 相談フォームがWindows/スマホで開く
- フォーム送信が管理画面に出る
- 友だち管理に追加ユーザーが出る
- `example.com` や `trycloudflare.com` が本番返信に残っていない

## 9. 本番化後に見るKPI

- 友だち追加数
- 目的選択率
- フォーム送信数
- 商談候補タグ数
- ブロック率
- 個別相談予約率
