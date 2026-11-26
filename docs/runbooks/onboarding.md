# 導入（オンボーディング）

設計書 §8.2 の手順を、実際のコマンドまで落としたものです。各ステップの完了を運用リポジトリのプルリクエストに記録します。

## 0. 開始条件（満たせなければ導入を始めない）

- [ ] 契約上の論点（設計書 §10：委託の位置づけ、再委託先の説明、侵害時の通知、AI キーの持ち主と費用）がクライアントと合意済み
- [ ] クライアントが自分のドメイン（またはサブドメイン）を **クライアント自身の Cloudflare** で管理できる

## 1. Cloudflare アカウント（クライアント作業）

1. クライアントが Cloudflare アカウントを作り、**二要素認証を有効化**する
2. NIBEL 担当者をメンバーとして招待する（必要最小の権限）
3. 使うドメインを Cloudflare に載せる。公開用 `customDomain`（例 `line.<client domain>`）と管理用 `adminDomain`（例 `admin.<client domain>`）の2つを決める

## 2. LINE（クライアント作業）

1. LINE 公式アカウント、Messaging API チャネル、LINE Login チャネル（LIFF 用）を作る
2. NIBEL 担当者を各チャネルに権限付きで追加する

## 3. D1 と client.json（NIBEL 作業）

```bash
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- d1 create <d1DatabaseName>
```

出力された ID を `client.json` の `d1DatabaseId` に書く。`access` はステップ5で埋める。運用リポジトリにプルリクエストを出し、`node scripts/render-wrangler-config.mjs --client "$CLIENT_CONFIG" --out /dev/null` が成功することを確認する。

## 4. GitHub Environment（NIBEL 作業）

1. 運用リポジトリに Environment `client-<slug>` を作る。必須承認者に小林さん、デプロイ可能ブランチは `main` のみ
2. クライアントのアカウントだけに効く Cloudflare API トークン（Workers Scripts 編集、D1 編集、該当ゾーンの Workers Routes 編集）を作り、Environment secret `CLOUDFLARE_API_TOKEN` に登録する

## 5. Cloudflare Access（管理画面の前段）

[本番チェックリスト §5a](../ai-line-crm-production-checklist.md) の通りに `adminDomain` だけを保護し、AUD タグとチームドメインを `client.json` の `access` に書く。MCP や初期データ投入を使うなら Service Auth のサービストークンも作る（トークンの値はパスワードマネージャーへ）。

## 6. アプリ用シークレット

クライアント自身がダッシュボードで入力するのが推奨。NIBEL が入れる場合は画面共有のもとで1つずつ対話入力する。

```bash
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- secret put API_KEY
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- secret put LINE_CHANNEL_ACCESS_TOKEN
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- secret put LINE_CHANNEL_SECRET
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- secret put LINE_LOGIN_CHANNEL_ID
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- secret put LINE_LOGIN_CHANNEL_SECRET
```

AI プロバイダーや Stripe、Google を使う場合も同じ方法で入れる（一覧は [secret-rotation.md](./secret-rotation.md)）。

## 7. 初回デプロイと初期化

新しい D1 は空なので、差分チェックの代わりにそのまま適用する。

```bash
pnpm db:migrate:client
pnpm deploy:client
node scripts/smoke-test.mjs --base-url https://<customDomain>
```

続けて [本番チェックリスト §5b](../ai-line-crm-production-checklist.md) の通り、`API_KEY` で入ってオーナーを作り、オーナーキーで入り直して `API_KEY` が `401` になることを確認する。`API_KEY` の Secret は**削除せず保管**する（全オーナーのキーを失ったときの復旧手段。オーナーがいる間は使えない）。オーナーは2人以上にする。

## 8. LINE 側の URL 設定と実機確認

1. Messaging API の Webhook URL を `https://<customDomain>/webhook` にして「検証」が成功すること
2. LIFF のエンドポイント URL、LINE Login のコールバック URL を `customDomain` に合わせる
3. [LINE 実機確認チェックリスト](../ai-line-crm-line-test-checklist.md) を通す
4. 結果を運用リポジトリのプルリクエストに記録して導入完了
