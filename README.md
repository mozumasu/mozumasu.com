# mozumasu.com

<https://mozumasu.com/> のトップページ。talks / blog / X / GitHub への入り口となる 1 ページの静的サイト。

## 構成

- `public/` — 配信するファイルすべて。ビルド工程はない
  - `brand.css` / `water.js` — ヘッダー・ガラス・カードなどの共通スタイルと、水面 + ガラス板を描く WebGL。**talks.mozumasu.com も `https://mozumasu.com/` のこの 2 つを直接読んでいる**ので、クラス名や `#water` の構造を変えるときは talks 側 (`scripts/index-page.mjs`) も合わせる
  - `index.html` — トップページ。ヒーロー固有のスタイルだけを同梱
  - 背景の水面は WebGL のフラグメントシェーダーで描画。WebGL が使えない環境では CSS グラデーションにフォールバックする
  - `prefers-reduced-motion: reduce` のときは 1 フレームだけ描いて止まる
  - `?t=<秒>` を付けると固定フレームを描画する (OGP 画像やスクリーンショット用)
- `wrangler.jsonc` — Cloudflare Workers (静的アセットのみ、Worker スクリプトなし)。カスタムドメイン `mozumasu.com`
- `.github/workflows/deploy.yml` — main への push で `wrangler deploy`

## 最近の活動 (Recent) の追加

`public/activities.json` に 1 件ずつ手で追加する。ページは新しい順に並べ、最初の 8 件だけ表示して残りは「すべて見る」で開く。日付が未来のものには upcoming が付く。

```json
{
  "date": "2026-09-09",
  "type": "talk",
  "title": "CLIオタクのキーボード事情",
  "venue": "MOSH Tech Meetup #5",
  "url": "https://talks.mozumasu.com/terminal-keyboard/",
  "event": "https://mosh.connpass.com/event/400858/",
  "thumb": "https://talks.mozumasu.com/terminal-keyboard/cover.png"
}
```

- `type`: `talk` (登壇) / `video` (出演) / `article` (記事) / `event` (主催)
- `venue`, `event`, `thumb`, `emoji` は任意。`thumb` がないものは `emoji` (なければ 🐱) のタイルになる
- `thumb` は `pnpm thumbs` で埋められる。リンク先の og:image を取り、YouTube は動画 ID から固定 URL を組む。connpass / docswell / Zenn / YouTube で動作確認済み

## ローカル確認

```sh
pnpm install
pnpm dev          # wrangler dev
```

静的ファイルなので `python3 -m http.server` 等で `public/` を配信するだけでも確認できる。

## デプロイ

GitHub Actions が main への push で自動デプロイする。リポジトリの Secrets に以下が必要:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

手動なら `pnpm deploy`。

## アイコン

`public/icon.png` (背景透過) と `public/icon-fade.png` (上下をフェード、トップページ用) は元画像の JPEG から生成している。
元画像を差し替えたら `favicon.ico` / `apple-touch-icon.png` / `icon-512.png` / `og.png` も作り直す。
