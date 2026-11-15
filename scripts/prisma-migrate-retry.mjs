import { spawn } from "node:child_process";
import pg from "pg";
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

// prisma migrate は対象の schema（notefable）が無いと黙って作り、空のテーブルを並べてしまう。
// 別の schema にすでに NoteFable のテーブルがあるのに notefable の履歴が無いときは、データを置き去りにしないよう止める。
async function assertSchemaInPlace() {
  if (!process.env.DATABASE_URL) return;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select
         exists (select 1 from information_schema.tables where table_schema = 'notefable' and table_name = '_prisma_migrations') as migrated,
         (select string_agg(distinct table_schema, ', ') from information_schema.tables where table_name = 'NotePage' and table_schema <> 'notefable') as elsewhere`,
    );
    const { migrated, elsewhere } = rows[0];
    if (!migrated && elsewhere) {
      console.error(`NoteFable tables exist in schema "${elsewhere}" but not in "notefable". Rename that schema to notefable before deploying.`);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  try {
    await assertSchemaInPlace();
  } catch (error) {
    if (attempt === MAX_ATTEMPTS) throw error;
    console.error(`Schema check failed (${error instanceof Error ? error.message : error}); retrying...`);
    await new Promise((resolve) => setTimeout(resolve, BASE_RETRY_DELAY_MS * attempt));
    continue;
  }
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
