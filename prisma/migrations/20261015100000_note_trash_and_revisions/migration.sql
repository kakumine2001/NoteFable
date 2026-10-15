-- CreateEnum
CREATE TYPE "NoteRevisionReason" AS ENUM ('AUTO', 'AI_EDIT', 'RESTORE');

-- AlterTable
ALTER TABLE "NotePage" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NoteRevision" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "NoteRevisionReason" NOT NULL,
    "title" TEXT NOT NULL,
    "icon" TEXT,
    "blocks" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteRevision_noteId_createdAt_idx" ON "NoteRevision"("noteId", "createdAt");

-- CreateIndex
CREATE INDEX "NoteRevision_userId_idx" ON "NoteRevision"("userId");

-- CreateIndex
CREATE INDEX "NotePage_userId_deletedAt_idx" ON "NotePage"("userId", "deletedAt");

-- AddForeignKey
ALTER TABLE "NoteRevision" ADD CONSTRAINT "NoteRevision_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "NotePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteRevision" ADD CONSTRAINT "NoteRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AnonymousUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
