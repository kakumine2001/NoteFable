ALTER TABLE "AnonymousUser" ADD COLUMN "googleSub" TEXT,
ADD COLUMN "email" TEXT,
ADD COLUMN "name" TEXT,
ADD COLUMN "image" TEXT;

CREATE UNIQUE INDEX "AnonymousUser_googleSub_key" ON "AnonymousUser"("googleSub");
