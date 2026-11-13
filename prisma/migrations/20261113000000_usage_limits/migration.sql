-- CreateEnum
CREATE TYPE "UserPlan" AS ENUM ('FREE', 'PRO');

-- AlterTable
ALTER TABLE "AnonymousUser" ADD COLUMN     "plan" "UserPlan" NOT NULL DEFAULT 'FREE';

-- CreateTable
CREATE TABLE "UsageCounter" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("key","kind","day")
);

-- CreateIndex
CREATE INDEX "UsageCounter_day_idx" ON "UsageCounter"("day");
