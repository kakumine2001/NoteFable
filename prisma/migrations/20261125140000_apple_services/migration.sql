ALTER TABLE "User" ADD COLUMN "appleSub" TEXT,
ADD COLUMN "appleRefreshToken" TEXT,
ADD COLUMN "appleOriginalTransactionId" TEXT,
ADD COLUMN "appleAppAccountToken" UUID;
CREATE UNIQUE INDEX "User_appleSub_key" ON "User"("appleSub");
CREATE UNIQUE INDEX "User_appleOriginalTransactionId_key" ON "User"("appleOriginalTransactionId");
CREATE UNIQUE INDEX "User_appleAppAccountToken_key" ON "User"("appleAppAccountToken");
