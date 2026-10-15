-- AlterTable
ALTER TABLE "ChatProject" ADD COLUMN     "instructions" TEXT;

-- CreateTable
CREATE TABLE "ChatProjectNote" (
    "projectId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatProjectNote_pkey" PRIMARY KEY ("projectId","noteId")
);

-- CreateIndex
CREATE INDEX "ChatProjectNote_noteId_idx" ON "ChatProjectNote"("noteId");

-- AddForeignKey
ALTER TABLE "ChatProjectNote" ADD CONSTRAINT "ChatProjectNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ChatProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatProjectNote" ADD CONSTRAINT "ChatProjectNote_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "NotePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
