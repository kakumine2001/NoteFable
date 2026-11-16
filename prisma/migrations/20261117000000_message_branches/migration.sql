-- AlterTable: 発言の編集・回答の再生成で会話を枝分かれさせる。既存の行は parentId が null（作成順の直前が親）で、すべて表示中。
ALTER TABLE "Message" ADD COLUMN "parentId" TEXT,
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
