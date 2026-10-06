CREATE TABLE "NoteCoverAsset" (
    "path" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NoteCoverAsset_pkey" PRIMARY KEY ("path")
);

CREATE INDEX "NoteCoverAsset_releasedAt_idx" ON "NoteCoverAsset"("releasedAt");
ALTER TABLE "NoteCoverAsset" ADD CONSTRAINT "NoteCoverAsset_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AnonymousUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
