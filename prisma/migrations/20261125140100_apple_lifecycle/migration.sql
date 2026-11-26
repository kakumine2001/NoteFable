ALTER TABLE "User"
ADD COLUMN "appleAuthorizedAt" TIMESTAMP(3),
ADD COLUMN "appleRevokedAt" TIMESTAMP(3),
ADD COLUMN "applePurchaseHoldUntil" TIMESTAMP(3);
