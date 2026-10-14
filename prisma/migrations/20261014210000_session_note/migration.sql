-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "noteId" TEXT;

-- CreateIndex
CREATE INDEX "Session_noteId_idx" ON "Session"("noteId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "NotePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
