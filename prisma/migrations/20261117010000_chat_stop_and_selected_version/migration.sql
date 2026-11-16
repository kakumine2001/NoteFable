-- AlterTable: 停止の要求（生成中の応答が見て止まる）と、版の切り替えで最後に選んだ版の記録。どちらも追加だけで、既存の行は NULL。
ALTER TABLE "Session" ADD COLUMN "stopRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "selectedAt" TIMESTAMP(3);
