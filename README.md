# mozumasu.com

<https://mozumasu.com/> のトップページ。talks / blog / X / GitHub への入り口となる 1 ページの静的サイト。

## 構成

- `public/` — 配信するファイルすべて。ビルド工程はなく、`index.html` に CSS / WebGL シェーダー / JS を同梱している
  - 背景の水面は WebGL のフラグメントシェーダーで描画。WebGL が使えない環境では CSS グラデーションにフォールバックする
  - `prefers-reduced-motion: reduce` のときは 1 フレームだけ描いて止まる
  - `?t=<秒>` を付けると固定フレームを描画する (OGP 画像やスクリーンショット用)
- `wrangler.jsonc` — Cloudflare Workers (静的アセットのみ、Worker スクリプトなし)。カスタムドメイン `mozumasu.com`
- `.github/workflows/deploy.yml` — main への push で `wrangler deploy`

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
