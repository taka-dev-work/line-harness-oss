# 既存 D1 の差分チェック：分かっていること・限界

`pnpm db:drift:client` と `pnpm db:adopt:client` の前提と限界です。

## 確認していること

- `0000_baseline.sql` にあるテーブルと列が、その D1 に**名前として**存在するか
- 読み取りはテーブルの一覧と、テーブルごとの `PRAGMA table_info` だけ。リモートの D1 は `pragma_table_info()` を関数として使う書き方を拒否するため（`SQLITE_AUTH`）
- `_cf_` で始まるテーブル（Cloudflare の内部用）と `d1_migrations` は対象外

## 確認していないこと（既知の限界）

- **列の型・既定値・NOT NULL・CHECK が違っていても検出しない。** 名前が一致すれば「ある」とみなす。古い D1 で手作業の変更をしたことがあるなら、移行前にエクスポートしたスキーマ（`d1 export --no-data`）と `0000_baseline.sql` を目で見比べる
- 同名で定義の違うインデックスはそのまま残る（`CREATE INDEX IF NOT EXISTS` は何もしない）
- 初期スキーマにない余分なテーブルは情報として表示するだけで、消さない

## 移行ツールが止まる場合

`ALTER TABLE … ADD COLUMN` で作れない列（主キー、既定値なしの NOT NULL、CHECK・UNIQUE・COLLATE・GENERATED 付き）が不足していると、SQL を出さずに `cannot ADD COLUMN <table>.<column>` で止まります。この場合はその列だけ手作業の移行（新テーブルへのコピー）が必要です。2026-11-26 時点のクライアント0号では該当なし。
