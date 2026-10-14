-- AlterTable
ALTER TABLE "NotePage" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "NoteGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteGroup_userId_position_idx" ON "NoteGroup"("userId", "position");

-- CreateIndex
CREATE INDEX "NotePage_userId_groupId_idx" ON "NotePage"("userId", "groupId");

-- AddForeignKey
ALTER TABLE "NotePage" ADD CONSTRAINT "NotePage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "NoteGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteGroup" ADD CONSTRAINT "NoteGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AnonymousUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

