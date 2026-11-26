# 解約（オフボーディング）

設計書 §8.3。データはクライアントのアカウントにあるので、NIBEL 側の作業は「渡す」「権限を返す」「手元に残さない」の3つです。

## 1. データの引き渡し（希望がある場合）

```bash
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- d1 export <d1DatabaseName> --remote --output <暗号化した保存先>/<slug>-final.sql
```

クライアントが自分のアカウントで直接エクスポートできるなら、そちらを優先する（NIBEL の手元を経由しない）。NIBEL が取った場合は、受け渡し後に**手元のファイルを削除**し、削除した日を記録する。

## 2. NIBEL 側の権限を外す

1. Cloudflare API トークン（Environment secret `CLOUDFLARE_API_TOKEN` の元）を**失効**させる
2. GitHub Environment `client-<slug>` を削除する
3. 運用リポジトリの `clients/<slug>/` を `clients/archive/<slug>/` へ移す（`client.json` に秘密情報はないので履歴に残してよい）
4. NIBEL が作ったサービストークン（Access の Service Auth）を削除する

## 3. クライアント側の作業を依頼する

1. Cloudflare アカウントから NIBEL メンバーを外す
2. LINE の各チャネルから NIBEL を外す
3. サービスを止める場合は Worker と D1 を削除する（クライアントの判断。削除は元に戻せない）

## 4. 完了確認

- [ ] NIBEL の手元にエクスポートが残っていない
- [ ] トークン・Environment・サービストークンが消えている
- [ ] 完了をクライアントと**書面で**確認した（日付を運用リポジトリに記録）
