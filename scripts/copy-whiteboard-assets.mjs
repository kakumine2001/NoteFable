#!/usr/bin/env node
// ホワイトボードが読む静的なファイルを node_modules から public/whiteboard/ へ写す（CDN からは読まない。自分のサイトから配る）。
// - fonts/：Excalidraw の図形用フォント（window.EXCALIDRAW_ASSET_PATH = "/whiteboard/"、src/components/whiteboard/whiteboard-editor.tsx）
// - pdf.worker.min.mjs：PDF の取り込みで使う pdf.js の worker（src/lib/whiteboard/pdf-import.ts。古い Safari / iOS 17.0〜17.3 でも動く legacy 版）
// - pdfjs/：pdf.js が必要な時だけ読む CMap（CJK のフォント）・標準フォント・wasm（JPEG 2000 など）・ICC プロファイル
// npm run dev / npm run build の前に自動で動く（package.json の predev / prebuild）。写した先は .gitignore 済み。
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = path.join(root, "node_modules");
const excalidraw = path.join(modules, "@excalidraw", "excalidraw");
const pdfjs = path.join(modules, "pdfjs-dist");
const fontsSource = path.join(excalidraw, "dist", "prod", "fonts");
const workerSource = path.join(pdfjs, "legacy", "build", "pdf.worker.min.mjs");
// pdf.js が読む資源（getDocument の cMapUrl・standardFontDataUrl・wasmUrl・iccUrl）。
const pdfjsDirs = ["cmaps", "standard_fonts", "wasm", "iccs"];
const target = path.join(root, "public", "whiteboard");
const stamp = path.join(target, ".version");

for (const source of [fontsSource, workerSource, ...pdfjsDirs.map((dir) => path.join(pdfjs, dir))]) {
  if (!existsSync(source)) {
    console.error(`[whiteboard-assets] ${source} is missing. Run npm install first.`);
    process.exit(1);
  }
}
const version = (dir) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;
// 写すものが増えたら末尾の番号を上げる（同じ版でも写し直す）。
const versions = `excalidraw ${version(excalidraw)}, pdfjs-dist ${version(pdfjs)}, assets 2`;
if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === versions && existsSync(path.join(target, "fonts")) && existsSync(path.join(target, "pdf.worker.min.mjs")) && pdfjsDirs.every((dir) => existsSync(path.join(target, "pdfjs", dir)))) process.exit(0);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(fontsSource, path.join(target, "fonts"), { recursive: true });
copyFileSync(workerSource, path.join(target, "pdf.worker.min.mjs"));
for (const dir of pdfjsDirs) cpSync(path.join(pdfjs, dir), path.join(target, "pdfjs", dir), { recursive: true });
writeFileSync(stamp, `${versions}\n`);
console.log(`[whiteboard-assets] copied ${versions}`);
