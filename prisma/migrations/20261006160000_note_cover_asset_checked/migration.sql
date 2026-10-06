ALTER TABLE "NoteCoverAsset" ADD COLUMN "checkedAt" TIMESTAMP(3);
CREATE INDEX "NoteCoverAsset_checkedAt_idx" ON "NoteCoverAsset"("checkedAt");
