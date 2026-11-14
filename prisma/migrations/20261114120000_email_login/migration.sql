-- AlterTable
ALTER TABLE "AnonymousUser" ADD COLUMN     "verifiedEmail" TEXT;

-- CreateTable
CREATE TABLE "EmailLoginCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requesterHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnonymousUser_verifiedEmail_key" ON "AnonymousUser"("verifiedEmail");

-- CreateIndex
CREATE INDEX "EmailLoginCode_email_createdAt_idx" ON "EmailLoginCode"("email", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLoginCode_requesterHash_createdAt_idx" ON "EmailLoginCode"("requesterHash", "createdAt");
