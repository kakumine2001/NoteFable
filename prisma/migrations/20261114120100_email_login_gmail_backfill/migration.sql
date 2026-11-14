-- 既存の Google 利用者: Gmail のアドレスは Google が必ず確認済みなので、ここで確認済みメールとして記録する
-- （ログイン中のセッションはサインインし直すまで確認済みの印を持たないため）。同じアドレスが複数あれば付けない。
UPDATE "AnonymousUser" AS u
SET "verifiedEmail" = lower(trim(u."email"))
WHERE u."googleSub" IS NOT NULL
  AND u."verifiedEmail" IS NULL
  AND u."email" IS NOT NULL
  AND (lower(trim(u."email")) LIKE '%@gmail.com' OR lower(trim(u."email")) LIKE '%@googlemail.com')
  AND (
    SELECT count(*) FROM "AnonymousUser" AS o
    WHERE o."googleSub" IS NOT NULL AND lower(trim(o."email")) = lower(trim(u."email"))
  ) = 1;
