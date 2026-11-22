-- CreateTable
CREATE TABLE "NoteEmbedding" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "blockId" TEXT,
    "chunkText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vector" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NoteEmbedding_noteId_chunkIndex_key" ON "NoteEmbedding"("noteId", "chunkIndex");

-- CreateIndex
CREATE INDEX "NoteEmbedding_userId_model_dimensions_idx" ON "NoteEmbedding"("userId", "model", "dimensions");

-- CreateIndex
CREATE INDEX "NoteEmbedding_noteId_idx" ON "NoteEmbedding"("noteId");

-- AddForeignKey
ALTER TABLE "NoteEmbedding" ADD CONSTRAINT "NoteEmbedding_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "NotePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteEmbedding" ADD CONSTRAINT "NoteEmbedding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
