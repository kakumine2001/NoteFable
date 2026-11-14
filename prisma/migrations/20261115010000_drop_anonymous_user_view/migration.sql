-- 表の改名（20261115000000_rename_user_table）のときに残した互換用のビューを消す。
-- 新しいコード（User を読み書きする）が公開済みなので、古い名前はもう使われない。
DROP VIEW IF EXISTS "AnonymousUser";
