# AI LINE CRM 本番化チェックリスト

このチェックリストは、ローカル検証済みのAI LINE CRMを本番運用へ移すための最短手順です。


導入・解約・障害対応・シークレット入れ替えの手順は [docs/runbooks/](runbooks/README.md) にまとめています。

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
`DRIFT` と表示されたら、マイグレーションを適用せずに [既存 D1 の移行手順](runbooks/client-0-adoption.md) へ進んでください
（`pnpm db:adopt:client` が不足分を追加し、初期スキーマを適用済みとして記録します）。

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

## 5a. 管理画面を Cloudflare Access で保護する（必須）

管理API は、Cloudflare Access を通ったリクエストにしか応答しません（`client.json` の `access` が必須）。

1. クライアントの Cloudflare で Zero Trust → Access → Applications に **Self-hosted** アプリを作り、ドメインに `adminDomain` を指定する。ポリシーで管理画面を使う人のメールアドレス（またはIdPグループ）だけを許可する
2. アプリの **AUD タグ**と、チームドメイン（`<team>.cloudflareaccess.com`）を `client.json` の `access.aud` / `access.teamDomain` に書いて再デプロイする
3. MCP などの自動操作を使う場合は Service Auth で**サービストークン**を作り、アプリのポリシーに Service Auth ルールを追加する（設定方法はインストールガイドの MCP Setup）
4. 確認: `customDomain` 側で管理API を叩くと `403 Access verification required` になること、`adminDomain` からはログイン後に管理画面が使えること

## 5b. 初期オーナーを作り、環境変数キーを無効化する

`API_KEY`（環境変数）は初期設定専用です。有効なオーナーが1人でもいると使えなくなります。

1. `API_KEY` で管理画面に入り、スタッフ画面でオーナーを作成する（表示されたキーは一度しか表示されない。パスワードマネージャーへ保存）
2. 発行されたオーナーキーで入り直し、`API_KEY` では `401` になることを確認する
3. 旧バージョンからの更新時は、オーナーで `POST /api/staff/rehash-keys` を1回実行し、平文で残っているスタッフキーをハッシュ化する
4. 通常運用ではオーナーを最低2人にしておく（管理画面からは最後の1人を無効化・削除できない）
5. **復旧手段**: オーナーキーを全員分失った場合は、Cloudflare の D1 で全オーナーを無効化すると、`API_KEY`（Worker Secret）が再び使えるようになる。このため `API_KEY` の Secret は削除せずに保管しておく

```bash
node scripts/with-client.mjs --client path/to/client.json -- d1 execute DB --remote --command "UPDATE staff_members SET is_active = 0 WHERE role = 'owner'"
```

   復旧後はすぐに新しいオーナーを作成し、`API_KEY` が再び `401` になることを確認する

操作の記録（監査ログ）は `audit_logs` テーブルに1年間保存されます。

## 6. CRM初期データを投入する

管理API は Access 保護下の `adminDomain` にだけ応答するため、5a で作ったサービストークンと、5b で作ったスタッフキー（オーナー等）を使います。環境変数の `API_KEY` は使えません。

```bash
LINE_HARNESS_API_URL=https://ADMIN_DOMAIN \
LINE_HARNESS_API_KEY=YOUR_STAFF_API_KEY \
LINE_HARNESS_ACCESS_CLIENT_ID=YOUR_ACCESS_SERVICE_TOKEN_ID.access \
LINE_HARNESS_ACCESS_CLIENT_SECRET=YOUR_ACCESS_SERVICE_TOKEN_SECRET \
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
