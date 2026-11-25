# AI LINE CRM 多段階実行フロー

このドキュメントは、`line-harness-oss` 上にAI活用向けLINE CRMを構築するための実行手順です。

## Stage 0. 前提確認

必要なもの:

- Cloudflare アカウント
- LINE公式アカウント
- LINE Developers の Messaging API チャネル
- LINE Login チャネル
- Node.js 20+
- pnpm

ローカル確認:

```bash
pnpm install
pnpm crm:validate:ai-line
pnpm crm:seed:ai-line --dry-run
pnpm crm:rich-menu:ai-line
```

## Stage 1. URL設定を作る

まずexampleをコピーして、本番URLを入れます。

```bash
cp config/ai-line-crm.urls.example.json config/ai-line-crm.urls.local.json
```

編集対象:

```text
config/ai-line-crm.urls.local.json
```

設定するURL:

| キー | 用途 |
|---|---|
| `guideIndex` | 無料ガイド一覧 |
| `booking` | 個別相談予約 |
| `bootcamp` | AIブートキャンプLP |
| `workshop` | 勉強会・ワークショップ案内 |
| `cases` | 導入事例 |
| `pricing` | 料金・サービス一覧 |
| `workBreakdown` | AI業務分解チェックリスト |
| `promptTemplates` | プロンプトテンプレート |
| `agentChecklist` | AIエージェント導入前チェックリスト |
| `automationUseCases` | 自動化できる業務例 |
| `consultForm` | 相談フォームまたは案内ページ |

本番投入前チェック:

```bash
pnpm crm:validate:ai-line -- --url-config=config/ai-line-crm.urls.local.json --strict-urls
```

## Stage 2. LINE Harnessをデプロイする

基本は公式READMEのクイックスタートを使います。

本番投入時の固定URL・secrets・D1・Webhook設定は、先に `docs/ai-line-crm-production-checklist.md` を確認してください。

```bash
npx create-line-harness
```

手動で進める場合:

```bash
npx wrangler d1 create line-crm
pnpm db:migrate:client
pnpm deploy:worker
pnpm deploy:web
```

LINE Developers Console では、Webhook URLを以下に設定します。

```text
https://your-worker.workers.dev/webhook
```

LINE側の設定:

- Use webhook: 有効
- Auto-reply messages: 無効
- Greeting messages: 無効

## Stage 3. CRM初期データを投入する

まずdry-runで投入内容を確認します。

```bash
LINE_HARNESS_API_URL=https://your-worker.workers.dev \
LINE_HARNESS_API_KEY=your-api-key \
pnpm crm:seed:ai-line -- --url-config=config/ai-line-crm.urls.local.json --dry-run
```

問題なければ本番投入します。

```bash
LINE_HARNESS_API_URL=https://your-worker.workers.dev \
LINE_HARNESS_API_KEY=your-api-key \
pnpm crm:seed:ai-line -- --url-config=config/ai-line-crm.urls.local.json --strict-urls
```

投入されるもの:

- タグ
- 相談ヒアリングフォーム
- 共通7日間シナリオ
- AIエージェント導入フォロー
- 勉強会フォロー
- キーワード自動返信
- キーワードに応じたタグ付け自動化

## Stage 4. リッチメニューを作る

リッチメニューpayloadを生成します。

```bash
pnpm crm:rich-menu:ai-line -- --url-config=config/ai-line-crm.urls.local.json
```

リッチメニュー画像のSVGデザインソースを生成します。

```bash
pnpm crm:rich-menu:svg:ai-line
```

LINEアップロード用のPNGを生成します。

```bash
pnpm crm:rich-menu:png:ai-line
```

生成先:

```text
generated/ai-line-rich-menu.json
generated/ai-line-rich-menu.svg
generated/ai-line-rich-menu.png
```

作成API:

```bash
curl -X POST "$LINE_HARNESS_API_URL/api/rich-menus" \
  -H "Authorization: Bearer $LINE_HARNESS_API_KEY" \
  -H "Content-Type: application/json" \
  --data @generated/ai-line-rich-menu.json
```

次に、2500 x 1686 px のリッチメニュー画像をアップロードします。

```bash
curl -X POST "$LINE_HARNESS_API_URL/api/rich-menus/{richMenuId}/image" \
  -H "Authorization: Bearer $LINE_HARNESS_API_KEY" \
  -H "Content-Type: image/png" \
  --data-binary @path/to/rich-menu.png
```

最後にデフォルト設定します。

```bash
curl -X POST "$LINE_HARNESS_API_URL/api/rich-menus/{richMenuId}/default" \
  -H "Authorization: Bearer $LINE_HARNESS_API_KEY"
```

## Stage 4.5. 本番投入前チェック

本番投入に必要な設定が揃っているか確認します。

```bash
LINE_HARNESS_API_URL=https://your-worker.workers.dev \
LINE_HARNESS_API_KEY=your-api-key \
pnpm crm:check:ai-line -- --url-config=config/ai-line-crm.urls.local.json
```

`NG` が出た項目を解消してから投入します。

## Stage 5. 実機テスト

自分のLINEで友だち追加して確認します。

チェック項目:

- 友だち追加で初回メッセージが届く
- `1` から `8` の返信で意図したメッセージが返る
- 管理画面でタグが付く
- 友だち追加シナリオが開始される
- `AI診断` で目的選択が再表示される
- `導入相談` で商談候補タグが付く
- フォーム送信で `商談候補` が付く
- リッチメニューの各枠が正しい導線に飛ぶ

7日間待たずにステップ配信を確認する場合は、短縮テストシナリオを作成します。

```bash
LINE_HARNESS_API_URL=http://localhost:5174 \
LINE_HARNESS_API_KEY=your-api-key \
pnpm crm:test-scenario:ai-line
```

作成後、管理画面で任意の友だちに `テスト_短縮配信` タグを付けると、数分間隔でテスト配信が始まります。

## Stage 6. 小規模公開

最初は少人数の流入で検証します。

- Xプロフィール
- note記事末尾
- 勉強会参加者
- LPの一部CTA

この時点では、配信数よりも目的選択率とブロック率を重視します。

## Stage 7. 改善サイクル

週次で見るもの:

- 友だち追加数
- 目的選択率
- 特典クリック率
- ブロック率
- 勉強会申込率
- 個別相談予約率
- 商談化率

改善順:

1. 初回メッセージ
2. リッチメニュー文言
3. 特典タイトル
4. Day1からDay7のCTA
5. 相談フォーム項目
6. 高温度リード通知

## Stage 8. 次の開発候補

- Slack通知
- クリック計測リンクの自動生成
- リッチメニュー画像生成
- Google Calendar予約連携
- AI自由相談ボット
- 商品別シナリオ分岐
- 高温度スコアリング
