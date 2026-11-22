// 生成 PWA 的图标（public/icon-192.png、public/icon-512.png），供 public/manifest.webmanifest 使用。
// 图形和 iOS 应用图标、网页标签页相同：src/app/icon.svg（默认角色 Quill），底色 #F7F6F2，图形缩到 86% 居中。
// 改了 src/app/icon.svg 之后运行：node node_modules/tsx/dist/cli.mjs scripts/gen-web-icons.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const BACKGROUND = "#F7F6F2";
const root = path.resolve(import.meta.dirname, "..");

async function render(size: number) {
  const art = Math.round(size * 0.86);
  const image = await sharp(readFileSync(path.join(root, "src/app/icon.svg")), { density: 600 })
    .resize(art, art, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const target = path.join(root, `public/icon-${size}.png`);
  await sharp({ create: { width: size, height: size, channels: 3, background: BACKGROUND } })
    .composite([{ input: image, gravity: "centre" }])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(target);
  console.log(`wrote ${path.relative(root, target)}`);
}

async function main() {
  await render(192);
  await render(512);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
