-- 利用者の表の名前を AnonymousUser から User に変える（ログインした利用者も同じ表に入るため）。
-- 列・データ・外部キーはそのままで、名前だけを変える。外部キーの制約名は子の表の名前で付いているので変わらない。
ALTER TABLE "AnonymousUser" RENAME TO "User";
ALTER TABLE "User" RENAME CONSTRAINT "AnonymousUser_pkey" TO "User_pkey";
ALTER INDEX "AnonymousUser_deviceId_key" RENAME TO "User_deviceId_key";
ALTER INDEX "AnonymousUser_googleSub_key" RENAME TO "User_googleSub_key";
ALTER INDEX "AnonymousUser_verifiedEmail_key" RENAME TO "User_verifiedEmail_key";

-- 切り替えの間の互換用。この移行は新しいコードが公開される前に走るので、それまで動いている古いコード
-- （AnonymousUser を読み書きする）が止まらないよう、古い名前を同じ表への更新可能なビューとして残す。
-- 新しいコードが公開されたあとの移行で消す。
CREATE VIEW "AnonymousUser" AS SELECT * FROM "User";
