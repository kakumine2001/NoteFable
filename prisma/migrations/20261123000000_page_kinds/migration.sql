-- Workspace page kinds (note / whiteboard / slides) and separate storage for whiteboard and slides content. Additive only:
-- existing pages become notes (the default), no existing row is rewritten.

-- CreateEnum
CREATE TYPE "PageKind" AS ENUM ('note', 'whiteboard', 'slides');

-- AlterTable
ALTER TABLE "NotePage" ADD COLUMN     "kind" "PageKind" NOT NULL DEFAULT 'note';

-- AlterTable
ALTER TABLE "NoteRevision" ADD COLUMN     "data" JSONB;

-- CreateTable
CREATE TABLE "NoteCanvas" (
    "noteId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "segments" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteCanvas_pkey" PRIMARY KEY ("noteId")
);

-- AddForeignKey
ALTER TABLE "NoteCanvas" ADD CONSTRAINT "NoteCanvas_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "NotePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
