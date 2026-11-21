// 生成 iOS 的应用图标（mobile/ios/NoteFable/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png）。
// 图形和网页标签页、Play 商店图标相同：src/app/icon.svg（默认角色 Quill），底色是 Android 启动图标的 #F7F6F2。
// iOS 自己裁圆角，所以图要满版、不透明；图形缩到 86% 居中，免得边缘被圆角裁到。
// 改了 src/app/icon.svg 之后运行：node node_modules/tsx/dist/cli.mjs scripts/gen-ios-app-icon.ts
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SIZE = 1024;
const ART = Math.round(SIZE * 0.86);
const BACKGROUND = "#F7F6F2";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "mobile/ios/NoteFable/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png");

async function main() {
  const art = await sharp(readFileSync(path.join(root, "src/app/icon.svg")), { density: 600 })
    .resize(ART, ART, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  mkdirSync(path.dirname(target), { recursive: true });
  await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: BACKGROUND } })
    .composite([{ input: art, gravity: "centre" }])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(target);
  console.log(`wrote ${path.relative(root, target)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
