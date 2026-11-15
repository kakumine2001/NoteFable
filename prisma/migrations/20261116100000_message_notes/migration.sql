-- CreateTable
CREATE TABLE "MessageNote" (
    "messageId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MessageNote_pkey" PRIMARY KEY ("messageId","noteId")
);

-- CreateIndex
CREATE INDEX "MessageNote_noteId_idx" ON "MessageNote"("noteId");

-- AddForeignKey
ALTER TABLE "MessageNote" ADD CONSTRAINT "MessageNote_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageNote" ADD CONSTRAINT "MessageNote_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "NotePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
