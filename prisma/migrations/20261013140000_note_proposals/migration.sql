CREATE TYPE "NoteProposalKind" AS ENUM ('EDIT', 'CREATE');
CREATE TYPE "NoteProposalStatus" AS ENUM ('PENDING', 'APPLIED', 'DISCARDED');

CREATE TABLE "NoteProposal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT,
    "kind" "NoteProposalKind" NOT NULL,
    "status" "NoteProposalStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "appliedPageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NoteProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NoteProposal_sessionId_createdAt_idx" ON "NoteProposal"("sessionId", "createdAt");
CREATE INDEX "NoteProposal_messageId_idx" ON "NoteProposal"("messageId");

ALTER TABLE "NoteProposal" ADD CONSTRAINT "NoteProposal_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AnonymousUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteProposal" ADD CONSTRAINT "NoteProposal_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
