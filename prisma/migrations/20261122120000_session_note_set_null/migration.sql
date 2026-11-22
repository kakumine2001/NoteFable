-- ノートの AI パネルで始めた会話は Chats の一覧にも出る普通の会話になった。ノートを完全に削除しても会話は残し、ノートとの結び付きだけを外す。
-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_noteId_fkey";

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "NotePage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
