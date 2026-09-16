import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { requireEnv } from "@/lib/env";
import { normalizeDatabaseSslMode } from "@/lib/database-url";

const globalForPrisma = globalThis as unknown as {
  // 開発時の hot reload で PrismaClient を作り直しすぎないよう、global に退避する。
  prisma?: PrismaClient;
};

const databaseUrl = normalizeDatabaseSslMode(requireEnv("DATABASE_URL"));
const schemaParam = new URL(databaseUrl).searchParams.get("schema") ?? undefined;

if (schemaParam && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaParam)) {
  throw new Error("DATABASE_URL schema must be a valid PostgreSQL identifier.");
}

export const databaseSchema = schemaParam ?? "studymate";

// Prisma 7 の PostgreSQL adapter。URL の schema は pg には効かないので adapter に明示する。
const adapter = new PrismaPg(databaseUrl, { schema: databaseSchema });

// production では通常どおり新規作成、development では既存 global インスタンスを再利用する。
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  // Next.js 開発サーバーの再読み込みで接続数が増え続けるのを防ぐ。
  globalForPrisma.prisma = prisma;
}
