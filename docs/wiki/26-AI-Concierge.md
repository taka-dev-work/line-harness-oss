# AIコンシェルジュ

AIコンシェルジュは、LINEで届いた質問が登録済みサービスに関係するかをWorker内で判定し、関係する場合だけAIへ回答を依頼します。OpenAI、Anthropic、Geminiを優先順位どおりに試し、一時的な障害が起きた場合は次のプロバイダーへ切り替えます。

## 安全な仕組み

1. LINEメッセージをWorkerが受信する
2. サービス名、関連キーワード、FAQ、継続中の会話をローカル判定する
3. 無関係なら固定文を返信し、セッションを終了する
4. 関係があれば、登録済みサービス情報だけを含むプロンプトでAIを呼ぶ
5. 結果にはプロバイダー名、モデル、トークン数、処理時間などの安全なメタデータだけを記録する

無関係と判定されたメッセージでは、OpenAI、Anthropic、Geminiの呼び出し回数はすべて0です。ただし、この保証は決定的なローカルルールに対するものです。表現が曖昧な質問は無関係と判定される場合があるため、「料金」のような一般語だけに頼らず、サービス固有のキーワードとFAQを登録してください。

## 1. D1を更新する

AIコンシェルジュ用テーブルは `packages/db/d1-migrations/` の初期スキーマに含まれています。
クライアント環境へは、生成済みの `apps/worker/wrangler.client.toml` を使って適用します。

```bash
pnpm db:migrate:client
```

## 2. AIプロバイダーを設定する

使用するプロバイダーのキーだけをCloudflare Secretへ登録します。値はソースコード、`wrangler.toml`、管理画面へ保存しません。

シークレットをファイルにまとめて同期する方法は使いません（PCに平文を残さないため）。クライアント本人が Cloudflare ダッシュボードで入力するか、担当者が `wrangler secret put` で対話入力します。

個別に登録する場合は次のコマンドを使います。

```bash
pnpm exec wrangler secret put OPENAI_API_KEY --config apps/worker/wrangler.client.toml
pnpm exec wrangler secret put ANTHROPIC_API_KEY --config apps/worker/wrangler.client.toml
pnpm exec wrangler secret put GEMINI_API_KEY --config apps/worker/wrangler.client.toml
```

モデル名は秘密情報ではないため、`apps/worker/wrangler.toml` の環境変数で任意に変更できます。

| 変数 | 用途 |
|---|---|
| `OPENAI_MODEL` | OpenAIモデル |
| `ANTHROPIC_MODEL` | Anthropicモデル |
| `GEMINI_MODEL` | Geminiモデル |

最低1つのプロバイダーSecretが必要です。複数設定すると、管理画面の優先順位に従ってフォールバックします。認証エラーなど再試行しても直らない失敗では、不必要な連続呼び出しを行いません。

## 3. サービス知識を登録する

管理画面で対象のLINEアカウントを選び、`AIコンシェルジュ` を開きます。まだ有効にはせず、次を先に登録します。

- サービス名と説明
- 料金
- 対象者
- サービス固有の関連キーワード
- 公式URL
- よくある質問と回答
- 無関係な質問への固定返信
- AI障害時の固定返信
- プロバイダーの優先順位

`関連性テスト` で、サービスに関係する質問が `relevant`、天気や宿題などが `off_topic` になることを確認します。AI APIキーは管理画面から入力・表示できません。

## 4. 段階的に有効化する

AIコンシェルジュは初期状態で無効です。次の順番で公開してください。

1. D1 migrationを適用する
2. AIプロバイダーSecretを登録する
3. サービス知識とFAQを登録する
4. 関連・無関連の実例を関連性テストへ入力する
5. テスト用LINEアカウントで固定返信、AI回答、フォールバックを確認する
6. 利用ログに本文やプロンプトが保存されていないことを確認する
7. 最後に `有効` をオンにする

設定不足のまま有効化しないでください。障害時は管理画面で無効にすると、既存の自動返信処理へ戻ります。

## 5. 外部WebhookのSecret

AIコンシェルジュとは別に、外部からWorkerを呼ぶ経路もSecretが必須です。Secretが未設定ならWorkerは処理せず、`503`で閉じます。

| 経路 | 必須設定 | 呼び出し側ヘッダー |
|---|---|---|
| Incoming Webhook | Webhook作成時に保存する共有Secret | `X-Webhook-Secret` |
| Meet callback | Cloudflare Secret `MEET_CALLBACK_SECRET` | `X-Meet-Callback-Secret` |
| Stripe webhook | Cloudflare Secret `STRIPE_WEBHOOK_SECRET` | Stripe標準の `Stripe-Signature` |

```bash
pnpm exec wrangler secret put MEET_CALLBACK_SECRET --config apps/worker/wrangler.client.toml
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET --config apps/worker/wrangler.client.toml
```

Incoming WebhookのSecretは作成・更新時だけ入力し、APIの応答では値ではなく `hasSecret` だけを返します。

## 6. 運用確認

- `off_topic` が続いてもAIトークン数が増えていない
- `success` のプロバイダーとモデルが想定どおり
- `fallbackCount` が増えた場合、先頭プロバイダーの状態を確認する
- `provider_error` が続く場合、Secret、モデル名、各社APIの稼働状況を確認する
- ログにメッセージ本文、完全なプロンプト、APIキーがない
- LINEアカウントを切り替えたとき、設定、FAQ、ログが混ざらない
