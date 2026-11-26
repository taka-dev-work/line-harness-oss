# インシデント対応

設計書 §8.4。キー漏えい、身に覚えのない操作、データ破損の疑いがあるときに使います。
**最初に止める、次に記録を見る、最後に戻す**の順で進めます。連絡の期限と経路はクライアントとの契約（設計書 §10）に従います。

## 1. 止める（疑わしいものはすべて失効）

| 対象 | やり方 |
|---|---|
| Cloudflare API トークン | Cloudflare ダッシュボードで失効し、新しいトークンを Environment secret に入れ直す |
| スタッフキー | 管理画面のスタッフ一覧で「無効化」または「キー再生成」（API なら `POST /api/staff/<id>/regenerate-key`）|
| `API_KEY` / `LEGACY_API_KEY` の漏えいが疑われる | オーナーが1人でもいる間は使えないが、復旧で全オーナーを無効化すると**両方とも有効に戻る**。先に `API_KEY` を新しい値で上書きし、`LEGACY_API_KEY` は削除する（`secret delete LEGACY_API_KEY`）|
| オーナーキー全滅・乗っ取り | 上の行を**先に**済ませてから、[本番チェックリスト §5b](../ai-line-crm-production-checklist.md) の復旧手順（全オーナー無効化 → 新しい `API_KEY` で入り直す → すぐにオーナーを作成）|
| Access サービストークン | Zero Trust → Access → Service Auth で削除し、作り直す |
| LINE チャネルアクセストークン | LINE Developers で再発行し、[secret-rotation.md](./secret-rotation.md) の手順で入れ替える |

## 2. 記録を見る

変更系の操作は `audit_logs` に残っています（本文・クエリ文字列・ヘッダーは記録しない）。期間を絞って見る:

```bash
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- d1 execute DB --remote --command "SELECT created_at, staff_id, staff_name, role, method, path, status, ip, access_email FROM audit_logs WHERE created_at >= '2026-01-01T00:00:00' ORDER BY created_at"
```

Cloudflare Access のログ（Zero Trust → Logs → Access）で、誰がいつ管理画面に入ったかも確認する。

## 3. D1 を戻す（必要な場合だけ）

戻す前に、今の状態を残しておく（調査用）。

```bash
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- d1 time-travel info <d1DatabaseName>
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- d1 export <d1DatabaseName> --remote --output <暗号化した保存先>/<slug>-before-restore.sql
```

戻す（**戻した時点以降の書き込みは消える**。友だち追加やフォーム送信も含む。必ず小林さんの承認を取る）:

```bash
node scripts/with-client.mjs --client "$CLIENT_CONFIG" -- d1 time-travel restore <d1DatabaseName> --bookmark=<ブックマーク>
```

`--timestamp=<UNIX 秒 または RFC3339>` でも指定できる。保持期間はプランによる（無料プランは短い）ので、疑いが出たら早めに `time-travel info` でブックマークを取る。

## 4. 振り返り

- 何が起きたか、いつ気づいたか、何を失効し何を戻したかを運用リポジトリに記録する
- クライアントへの報告内容と日時を記録する
