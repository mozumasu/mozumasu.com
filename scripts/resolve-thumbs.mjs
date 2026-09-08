// public/activities.json の thumb が空の項目に、リンク先の og:image (YouTube は動画 ID からの固定 URL) を書き込む。
// usage: node scripts/resolve-thumbs.mjs
import { readFile, writeFile } from "node:fs/promises";

const file = new URL("../public/activities.json", import.meta.url);
const items = JSON.parse(await readFile(file, "utf8"));

const youtubeId = (url) => {
  const m = url.match(/(?:youtu\.be\/|[?&]v=)([\w-]{11})/);
  return m ? m[1] : null;
};

const ogImage = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (mozumasu.com thumb resolver)" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const html = await res.text();
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/);
  return m ? m[1] : null;
};

let changed = 0;
for (const item of items) {
  if (item.thumb || !item.url) continue;
  const id = youtubeId(item.url);
  const thumb = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : await ogImage(item.url).catch((e) => (console.warn(`skip: ${e.message}`), null));
  if (!thumb) continue;
  item.thumb = thumb;
  changed++;
  console.log(`${item.date}  ${item.title}\n  -> ${thumb}`);
}

if (changed) await writeFile(file, JSON.stringify(items, null, 2) + "\n");
console.log(`${changed} thumb(s) resolved`);
