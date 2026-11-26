# 運用手順（runbook）

クライアントごとの別環境（クライアント所有の Cloudflare アカウント + D1 + LINE チャネル）を運用するための手順書です。
設計の根拠は [設計書](../superpowers/specs/2026-11-26-per-client-deployment-design.md) にあります。

| 手順書 | 使う場面 |
|---|---|
| [onboarding.md](./onboarding.md) | 新しいクライアントの導入 |
| [offboarding.md](./offboarding.md) | 解約 |
| [incident.md](./incident.md) | キー漏えい・不正操作・障害の疑い |
| [secret-rotation.md](./secret-rotation.md) | シークレットの定期／臨時ローテーション |
| [client-0-adoption.md](./client-0-adoption.md) | マイグレーション管理以前に作った既存 D1（クライアント0号）の移行 |
| [legacy-d1-notes.md](./legacy-d1-notes.md) | 既存 D1 の差分チェックで分かっていること・限界 |

## 共通ルール

- **このリポジトリは公開です。** アカウントID、D1 ID、メールアドレス、キー、顧客データを手順書・コミットに書かない。クライアント固有の値は運用リポジトリの `clients/<slug>/client.json` にだけ置く（秘密情報は置かない）
- **シークレットは対話入力だけ。** Cloudflare ダッシュボードか `wrangler secret put` で入力する。ファイル経由で流し込まない
- **本番への書き込みは承認制。** 運用リポジトリの GitHub Environment（承認者: 小林さん）を通す。手元から本番に書き込むのは、この手順書が明示している場合だけ
- **D1 のエクスポートは個人情報を含む。** 暗号化した場所（例: 暗号化ディスクイメージ）に置き、どのリポジトリにも入れない。作業が終わったら保管期限を決めて削除する
- 本番に書き込む前には、必ず Time Travel のブックマークを記録する（[incident.md](./incident.md) の「D1 を戻す」で使う）

## コマンドの書き方

どの手順も、クライアントの設定ファイルを `CLIENT_CONFIG` で渡します。

```bash
export CLIENT_CONFIG=path/to/clients/<slug>/client.json
pnpm db:drift:client
```

`node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- <wrangler の引数>` は、そのクライアント用の設定を毎回生成してから wrangler を実行します。
