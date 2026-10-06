ALTER TABLE "NoteCoverAsset" ADD COLUMN "deletingAt" TIMESTAMP(3);

-- 資産表より前に保存されたアップロードカバーを、使用中として登録する。
INSERT INTO "NoteCoverAsset" ("path", "userId", "releasedAt", "createdAt")
SELECT DISTINCT substring("cover" FROM 8), "userId", NULL::TIMESTAMP(3), CURRENT_TIMESTAMP
FROM "NotePage"
WHERE "cover" LIKE 'upload:page-covers/%'
  AND substring("cover" FROM 8) LIKE 'page-covers/' || "userId" || '/%'
ON CONFLICT ("path") DO NOTHING;
