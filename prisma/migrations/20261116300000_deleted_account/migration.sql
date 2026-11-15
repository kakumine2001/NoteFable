-- CreateTable
CREATE TABLE "DeletedAccount" (
    "key" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeletedAccount_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "DeletedAccount_deletedAt_idx" ON "DeletedAccount"("deletedAt");
