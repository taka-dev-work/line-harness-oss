# シークレットのローテーション

設計書 §5.5。シークレットは **Worker Secret にだけ**存在します。GitHub にも運用リポジトリにも置きません。
入れ替えは「新しい値を発行 → Worker Secret を上書き → 動作確認 → 古い値を失効」の順です。古い値を先に失効させると、その間サービスが止まります。

## 入れ替え方（共通）

```bash
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- secret put <NAME>
```

値は対話入力で貼り付ける（ファイルやコマンド履歴に残さない）。`secret put` の後、Worker は自動で新しい値を使う（再デプロイ不要）。

## シークレットごとの手順

| NAME | 発行元 | 確認方法 | 古い値の失効 |
|---|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers → Messaging API → チャネルアクセストークン（長期）を再発行 | 管理画面からテスト送信できる | 再発行時に旧トークンは無効になる（猶予なし）。送信の少ない時間に行う |
| `LINE_CHANNEL_SECRET` | LINE Developers → チャネル基本設定で再発行 | Webhook の「検証」が成功する | 再発行で即時無効 |
| `LINE_LOGIN_CHANNEL_SECRET` | LINE Login チャネルで再発行 | LIFF からログインできる | 再発行で即時無効 |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | 各プロバイダーの管理画面（キーの持ち主は契約で決める） | AI コンシェルジュが応答する | 各管理画面で旧キーを削除 |
| `STRIPE_WEBHOOK_SECRET` | Stripe ダッシュボード → Webhook エンドポイントの署名シークレットをローテーション（旧シークレットに猶予期限を設定できる） | Webhook の送信テストが `2xx` | 猶予期限で自動失効 |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Google Cloud Console → サービスアカウント → 新しい鍵を作成 | カレンダー連携の予約が作成できる | Console で旧鍵を削除 |
| `MEET_CALLBACK_SECRET` | 自分で高エントロピーの値を生成し、呼び出し側にも同じ値を設定 | Meet 連携のコールバックが成功する | 上書きで旧値は無効 |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API（画像保存に使う場合） | 管理画面から画像をアップロードできる | Supabase で旧キーを無効化（JWT シークレット再発行は全キーに影響するので注意） |
| `IG_HARNESS_LINK_SECRET` | 自分で生成し、連携先にも同じ値を設定（使う場合のみ） | 連携先からのリクエストが通る | 上書きで旧値は無効 |
| `API_KEY` | 自分で高エントロピーの値を生成 | オーナーがいる間は `401` になること（初期設定・復旧専用） | 上書きで旧値は無効 |

Access のサービストークン（MCP・初期データ投入用）は Worker Secret ではなく、使う側の環境変数 `LINE_HARNESS_ACCESS_CLIENT_ID` / `LINE_HARNESS_ACCESS_CLIENT_SECRET` に入っています。Zero Trust → Access → Service Auth で新しいトークンを作り、使う側を入れ替えてから古いトークンを削除します。

## 記録

いつ・どのシークレットを・なぜ入れ替えたかを運用リポジトリに残す（値は書かない）。
