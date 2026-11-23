#!/usr/bin/env node
// ホワイトボードが読む静的なファイルを node_modules から public/whiteboard/ へ写す（CDN からは読まない。自分のサイトから配る）。
// - fonts/：Excalidraw の図形用フォント（window.EXCALIDRAW_ASSET_PATH = "/whiteboard/"、src/components/whiteboard/whiteboard-editor.tsx）
// - pdf.worker.min.mjs：PDF の取り込みで使う pdf.js の worker（src/lib/whiteboard/pdf-import.ts）
// npm run dev / npm run build の前に自動で動く（package.json の predev / prebuild）。写した先は .gitignore 済み。
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = path.join(root, "node_modules");
const excalidraw = path.join(modules, "@excalidraw", "excalidraw");
const pdfjs = path.join(modules, "pdfjs-dist");
const fontsSource = path.join(excalidraw, "dist", "prod", "fonts");
const workerSource = path.join(pdfjs, "build", "pdf.worker.min.mjs");
const target = path.join(root, "public", "whiteboard");
const stamp = path.join(target, ".version");

for (const source of [fontsSource, workerSource]) {
  if (!existsSync(source)) {
    console.error(`[whiteboard-assets] ${source} is missing. Run npm install first.`);
    process.exit(1);
  }
}
const version = (dir) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;
const versions = `excalidraw ${version(excalidraw)}, pdfjs-dist ${version(pdfjs)}`;
if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === versions && existsSync(path.join(target, "fonts")) && existsSync(path.join(target, "pdf.worker.min.mjs"))) process.exit(0);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(fontsSource, path.join(target, "fonts"), { recursive: true });
copyFileSync(workerSource, path.join(target, "pdf.worker.min.mjs"));
writeFileSync(stamp, `${versions}\n`);
console.log(`[whiteboard-assets] copied ${versions}`);
