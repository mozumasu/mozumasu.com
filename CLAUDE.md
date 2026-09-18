# mozumasu.com

<https://mozumasu.com/> のトップページ。ビルド工程のない静的サイト (Cloudflare Workers の static assets)。
概要と運用は README.md を読む。ここには作業時に間違えやすい点だけ書く。

## 構成の要点

- 配信物は `public/` だけ。`index.html` はヒーロー固有の CSS を持ち、共通部分は `brand.css` と `water.js`
- **`brand.css` / `water.js` / `icon-64.png` は talks.mozumasu.com からも直接読まれている**
  (`mozumasu/talks` の `scripts/index-page.mjs`)。クラス名、`#water` キャンバスの前提、
  `glasschange` イベントの契約を変えるときは talks 側も同時に直す
- `water.js` は水面をドキュメント全体に重ねたキャンバスに描き、`.glass` 要素の位置にガラス板を描く。
  要素側に `filter` や `mask` を足すと GPU 合成で四角い影が出る。見た目の効果はシェーダー側に寄せる
- `public/activities.json` は手書き。`thumb` を空にして `pnpm thumbs` で og:image を埋める
- `mockups/` はデザイン検討時のモック。配信されない。参考にはなるが古い

## ローカル確認

- サーバー: `cd public && ghost run -- portless mozumasu sh -c 'exec python3 -m http.server "$PORT" --bind 127.0.0.1'`
  → <https://mozumasu.localhost:1355/>
- スクリーンショットは headless-render スキルの手順で撮る。ページ側の撮影用パラメータ:
  - `?t=<秒>`: 水面を固定フレームで描く (毎回同じ絵になる)
  - `?og=1`: ヘッダー・フッター・タイル・セクションを消す (OGP 画像用の構図)
- スマホ幅は 390px の iframe で再現する (ヘッドレス Chrome は 500px 未満にならない)
- Arc の実機描画で確認したいときは arc-browser スキルの「応答するタブに直接 CDP」を使う

## 変更のたびに確認すること

- デスクトップ 1440x900 のファーストビュー、スマホ幅、`?og=1` の 3 つを描画して崩れがないか見る
- `og.png` を作り直したら `index.html` の `og:image` の `?v=` を上げる (Slack / X が URL 単位でキャッシュする)
- `pnpm exec wrangler deploy --dry-run` で設定が通るか確認する

## デプロイ

main への push で GitHub Actions が `wrangler deploy` する。PR をマージすれば本番に出る。
talks 側が依存するファイルを変えた PR は、先にこちらをマージ・デプロイしてから talks の PR をマージする。
