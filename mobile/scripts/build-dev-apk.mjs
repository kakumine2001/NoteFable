// 本機の開発サーバー（http://localhost:3000）を開く検証用 APK を作る。デプロイ前の変更を実機・エミュレーターの App 内で確認するためのもの。
// capacitor.config.json を一時的に書き換えて APK を作り、終わったら必ず元に戻す。成果物は dist/StudyMate-dev.apk（git 管理外）。
// 使い方: 先に `npm run dev`（リポジトリ直下）を起動し、`adb reverse tcp:3000 tcp:3000` を実行してからインストールする。
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const mobile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(mobile, "capacitor.config.json");
const original = await readFile(configPath, "utf8");
const isWindows = process.platform === "win32";

// Ctrl+C などで途中終了しても、設定ファイルが開発用のまま残らないようにする。
process.on("exit", () => writeFileSync(configPath, original));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(1));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: isWindows });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

try {
  const config = JSON.parse(original);
  config.server = {
    ...config.server,
    url: "http://localhost:3000",
    cleartext: true,
    androidScheme: "http",
    allowNavigation: ["localhost"],
  };
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");

  run("npx", ["cap", "sync", "android"], mobile);
  run(isWindows ? ".\\gradlew.bat" : "./gradlew",["assembleDebug", "--console=plain"], path.join(mobile, "android"));

  await mkdir(path.join(mobile, "dist"), { recursive: true });
  await copyFile(
    path.join(mobile, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
    path.join(mobile, "dist", "StudyMate-dev.apk"),
  );
  console.log("\nBuilt mobile/dist/StudyMate-dev.apk (loads http://localhost:3000)");
} finally {
  await writeFile(configPath, original);
  run("npx", ["cap", "sync", "android"], mobile);
}
