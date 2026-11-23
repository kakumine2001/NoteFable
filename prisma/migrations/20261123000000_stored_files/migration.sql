-- ファイル置き場のファイルを 1 つずつ記録する表（容量の上限と、参照されなくなったファイルの後片付け）。
-- これまでの NoteCoverAsset（カバーとページアイコンの画像だけを記録していた）を引き継いで置き換える。
CREATE TYPE "StoredFileKind" AS ENUM ('NOTE_FILE', 'NOTE_COVER', 'CHAT_IMAGE', 'AVATAR', 'APP_ICON');

CREATE TABLE "StoredFile" (
    "path" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "StoredFileKind" NOT NULL,
    "size" INTEGER,
    "releasedAt" TIMESTAMP(3),
    "deletingAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("path")
);

CREATE INDEX "StoredFile_userId_idx" ON "StoredFile"("userId");
CREATE INDEX "StoredFile_releasedAt_idx" ON "StoredFile"("releasedAt");
CREATE INDEX "StoredFile_checkedAt_idx" ON "StoredFile"("checkedAt");

ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- カバーとページアイコンの記録は状態ごと引き継ぐ。大きさは分からないので null（ファイル置き場の一覧から後で補う）。
INSERT INTO "StoredFile" ("path", "userId", "kind", "size", "releasedAt", "deletingAt", "checkedAt", "createdAt")
SELECT "path", "userId", 'NOTE_COVER', NULL, "releasedAt", "deletingAt", "checkedAt", "createdAt"
FROM "NoteCoverAsset";

DROP TABLE "NoteCoverAsset";

-- チャットの画像（添付と生成画像）は添付の行に大きさと持ち主があるので、使用中として登録する。
-- 枝分かれ・発言の編集で同じ画像を複数の添付が指すことがある（持ち主は同じ利用者）。
INSERT INTO "StoredFile" ("path", "userId", "kind", "size", "releasedAt", "createdAt")
SELECT DISTINCT ON (a."imageStoragePath") a."imageStoragePath", s."userId", 'CHAT_IMAGE', a."size", NULL::TIMESTAMP(3), a."createdAt"
FROM "Attachment" a
JOIN "Message" m ON m."id" = a."messageId"
JOIN "Session" s ON s."id" = m."sessionId"
WHERE a."imageStoragePath" IS NOT NULL
ORDER BY a."imageStoragePath", a."createdAt"
ON CONFLICT ("path") DO NOTHING;

CREATE INDEX "Attachment_imageStoragePath_idx" ON "Attachment"("imageStoragePath");

CREATE TABLE "MaintenanceJob" (
    "name" TEXT NOT NULL,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "state" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceJob_pkey" PRIMARY KEY ("name")
);
