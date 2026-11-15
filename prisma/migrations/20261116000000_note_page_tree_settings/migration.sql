-- Sub-pages, favorites and page settings (Notion-style). Additive only.
-- AlterTable
ALTER TABLE "NotePage" ADD COLUMN     "favoritedAt" TIMESTAMP(3),
ADD COLUMN     "font" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN     "fullWidth" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "smallText" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "NotePage_parentId_idx" ON "NotePage"("parentId");

-- AddForeignKey
ALTER TABLE "NotePage" ADD CONSTRAINT "NotePage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "NotePage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

