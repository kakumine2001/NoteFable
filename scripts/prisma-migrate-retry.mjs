import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 5_000;
const prismaCliPath = fileURLToPath(import.meta.resolve("prisma/build/index.js"));

function runMigration() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCliPath, "migrate", "deploy"], {
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

function isRetryableConnectionFailure(output) {
  // Neon の起動待ちや一時的な接続タイムアウトだけを再試行する。
  return /P1001|P1002|Can't reach database server|timed out/i.test(output);
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const result = await runMigration();
  if (result.code === 0) process.exit(0);

  if (!isRetryableConnectionFailure(result.output) || attempt === MAX_ATTEMPTS) {
    process.exit(result.code);
  }

  const delayMs = BASE_RETRY_DELAY_MS * attempt;
  console.error(
    `Database is temporarily unavailable. Retrying migration in ${delayMs / 1000}s (${attempt}/${MAX_ATTEMPTS})...`,
  );
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
