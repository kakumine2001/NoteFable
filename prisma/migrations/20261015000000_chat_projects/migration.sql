ALTER TABLE "Session" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "titleManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "projectId" TEXT;
CREATE TABLE "ChatProject" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatProject_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatProject_userId_createdAt_idx" ON "ChatProject"("userId", "createdAt");
CREATE INDEX "Session_userId_projectId_idx" ON "Session"("userId", "projectId");
ALTER TABLE "ChatProject" ADD CONSTRAINT "ChatProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AnonymousUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ChatProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
