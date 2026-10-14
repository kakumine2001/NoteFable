ALTER TABLE "Session" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NotePage" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
WITH ranks AS (SELECT "id", row_number() OVER (PARTITION BY "userId" ORDER BY "updatedAt" DESC, "id" DESC) AS pos FROM "Session")
UPDATE "Session" AS s SET "position" = ranks.pos FROM ranks WHERE s."id" = ranks."id";
WITH ranks AS (SELECT "id", row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC, "id" DESC) AS pos FROM "NotePage")
UPDATE "NotePage" AS p SET "position" = ranks.pos FROM ranks WHERE p."id" = ranks."id";
