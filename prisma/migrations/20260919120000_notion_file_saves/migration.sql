-- CreateEnum
CREATE TYPE "NotionSaveStatus" AS ENUM ('STAGING', 'TRANSFERRING', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotionFileStatus" AS ENUM ('PENDING', 'STAGED', 'UPLOADING', 'COMPLETE');

-- CreateTable
CREATE TABLE "NotionSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "title" TEXT NOT NULL,
    "status" "NotionSaveStatus" NOT NULL DEFAULT 'STAGING',
    "blocks" JSONB NOT NULL,
    "notionPageId" TEXT,
    "notionPageUrl" TEXT,
    "notionBlocksWritten" INTEGER NOT NULL DEFAULT 0,
    "pageCreationUnknown" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotionSave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotionSaveFile" (
    "id" TEXT NOT NULL,
    "saveId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "blockType" TEXT NOT NULL,
    "status" "NotionFileStatus" NOT NULL DEFAULT 'PENDING',
    "stagingPrefix" TEXT,
    "stagingChunkCount" INTEGER NOT NULL DEFAULT 0,
    "partCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedParts" INTEGER NOT NULL DEFAULT 0,
    "notionFileUploadId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotionSaveFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotionSave_userId_createdAt_idx" ON "NotionSave"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotionSave_status_updatedAt_idx" ON "NotionSave"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "NotionSaveFile_saveId_idx" ON "NotionSaveFile"("saveId");

-- AddForeignKey
ALTER TABLE "NotionSave" ADD CONSTRAINT "NotionSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AnonymousUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotionSave" ADD CONSTRAINT "NotionSave_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotionSaveFile" ADD CONSTRAINT "NotionSaveFile_saveId_fkey" FOREIGN KEY ("saveId") REFERENCES "NotionSave"("id") ON DELETE CASCADE ON UPDATE CASCADE;
