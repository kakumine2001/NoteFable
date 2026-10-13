// public/icon.svg から、@capacitor/assets が使う元画像を作る。
// 安卓のアダプティブアイコンは外周が切り抜かれるので、前景は中央の約 66% に収める。
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, "..", "resources");
const svg = await readFile(path.join(root, "..", "..", "public", "icon.svg"), "utf8");
await mkdir(out, { recursive: true });

// 背景の角丸四角（#f7f6f2）を外した、本だけの SVG。
const book = svg.replace(/<rect[^>]*\/>/, "");
const BACKGROUND = "#f7f6f2";
const SIZE = 1024;

async function render(markup, size) {
  return sharp(Buffer.from(markup.replace("<svg ", `<svg width="${size}" height="${size}" `)), { density: 300 }).resize(size, size).png().toBuffer();
}

// 前景: 透明な 1024px の中央に 66% の大きさで本を置く。
const inner = Math.round(SIZE * 0.66);
const foreground = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await render(book, inner), top: Math.round((SIZE - inner) / 2), left: Math.round((SIZE - inner) / 2) }])
  .png().toFile(path.join(out, "icon-foreground.png"));

await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: BACKGROUND } }).png().toFile(path.join(out, "icon-background.png"));
// 旧端末向けの通常アイコン: 背景つきで本を 78% に。
const full = Math.round(SIZE * 0.78);
await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: BACKGROUND } })
  .composite([{ input: await render(book, full), top: Math.round((SIZE - full) / 2), left: Math.round((SIZE - full) / 2) }])
  .png().toFile(path.join(out, "icon-only.png"));
// 起動画面: 白地の中央に本。
await sharp({ create: { width: 2732, height: 2732, channels: 3, background: "#ffffff" } })
  .composite([{ input: await render(svg, 480), top: (2732 - 480) / 2, left: (2732 - 480) / 2 }])
  .png().toFile(path.join(out, "splash.png"));
await sharp({ create: { width: 2732, height: 2732, channels: 3, background: "#ffffff" } })
  .composite([{ input: await render(svg, 480), top: (2732 - 480) / 2, left: (2732 - 480) / 2 }])
  .png().toFile(path.join(out, "splash-dark.png"));
console.log("icons written to", out, foreground.width);
