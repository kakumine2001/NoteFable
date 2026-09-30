CREATE TABLE "NotePage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "blocks" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotePage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotePage_userId_updatedAt_idx" ON "NotePage"("userId", "updatedAt");
ALTER TABLE "NotePage" ADD CONSTRAINT "NotePage_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AnonymousUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
