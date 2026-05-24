-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "imageStoragePath" TEXT;

-- Existing Data URL payloads are intentionally discarded. New image payloads are
-- stored on disk and referenced by imageStoragePath instead of living in Postgres.
ALTER TABLE "Attachment" DROP COLUMN IF EXISTS "imageDataUrl";

-- CreateTable
CREATE TABLE "ApiRateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiRateLimit_pkey" PRIMARY KEY ("key")
);
