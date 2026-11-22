-- Public note sharing (Notion-style publish, sub-page inheritance, link expiration). Additive only.
-- AlterTable
ALTER TABLE "NotePage" ADD COLUMN     "shareEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shareExcludeFromParent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shareExpiresAt" TIMESTAMP(3),
ADD COLUMN     "shareIncludeSubpages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "NotePage_shareToken_key" ON "NotePage"("shareToken");
