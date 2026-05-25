import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { requireEnv } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  // 開発時の hot reload で PrismaClient を作り直しすぎないよう、global に退避する。
  prisma?: PrismaClient;
};

// Prisma 7 の PostgreSQL adapter。DATABASE_URL は必須環境変数として扱う。
const adapter = new PrismaPg(requireEnv("DATABASE_URL"));

// production では通常どおり新規作成、development では既存 global インスタンスを再利用する。
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  // Next.js 開発サーバーの再読み込みで接続数が増え続けるのを防ぐ。
  globalForPrisma.prisma = prisma;
}
