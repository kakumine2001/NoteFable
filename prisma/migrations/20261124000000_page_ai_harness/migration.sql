-- AI harness (#158): proposals for every page kind, auto-apply, undo, and a marker for pages the AI wrote.
-- Additive only: existing proposals become note proposals (the default) and no existing row is rewritten.

-- AlterEnum
ALTER TYPE "NoteProposalStatus" ADD VALUE 'UNDONE';

-- AlterTable
ALTER TABLE "NoteProposal" ADD COLUMN     "pageKind" "PageKind" NOT NULL DEFAULT 'note',
ADD COLUMN     "autoApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "appliedVersion" INTEGER,
ADD COLUMN     "revisionId" TEXT;

-- AlterTable
ALTER TABLE "NotePage" ADD COLUMN     "aiUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "NoteProposal_userId_appliedPageId_idx" ON "NoteProposal"("userId", "appliedPageId");

-- Backfill: applied edit proposals point at the page they wrote (as applied creates already do), and pages the AI
-- already wrote through an applied proposal get the marker, so "Report AI content" covers them too.
UPDATE "NoteProposal" SET "appliedPageId" = "payload"->>'pageId'
WHERE "kind" = 'EDIT' AND "status" = 'APPLIED' AND "appliedPageId" IS NULL AND jsonb_typeof("payload"->'pageId') = 'string';

UPDATE "NotePage" p SET "aiUpdatedAt" = a."at"
FROM (
  SELECT "appliedPageId" AS "id", "userId", max("updatedAt") AS "at"
  FROM "NoteProposal"
  WHERE "status" = 'APPLIED' AND "appliedPageId" IS NOT NULL
  GROUP BY "appliedPageId", "userId"
) a
WHERE p."id" = a."id" AND p."userId" = a."userId";
