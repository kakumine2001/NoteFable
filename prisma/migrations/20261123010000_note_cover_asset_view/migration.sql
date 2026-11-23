-- 移行の間の互換: 20261123000000_stored_files は NoteCoverAsset を StoredFile に移して消した。
-- 新しいデプロイが公開されるまで、前のデプロイはまだ NoteCoverAsset を読み書きする（カバー・ページアイコンのアップロード、
-- それを含むノートの保存、後片付け）。同じ名前のビューで StoredFile のカバーの行を見せ、追加は StoredFile へ通す。
-- 更新と削除は単純なビューなので StoredFile にそのまま届く。次の移行でこのビューを消す（docs/architecture/database.md）。
CREATE VIEW "NoteCoverAsset" AS
SELECT "path", "userId", "releasedAt", "deletingAt", "checkedAt", "createdAt"
FROM "StoredFile"
WHERE "kind" = 'NOTE_COVER';

ALTER VIEW "NoteCoverAsset" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE FUNCTION "note_cover_asset_view_insert"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO "StoredFile" ("path", "userId", "kind", "size", "releasedAt", "deletingAt", "checkedAt", "createdAt")
  VALUES (NEW."path", NEW."userId", 'NOTE_COVER', NULL, NEW."releasedAt", NEW."deletingAt", NEW."checkedAt", COALESCE(NEW."createdAt", CURRENT_TIMESTAMP));
  RETURN NEW;
END;
$$;

CREATE TRIGGER "NoteCoverAsset_insert" INSTEAD OF INSERT ON "NoteCoverAsset"
FOR EACH ROW EXECUTE FUNCTION "note_cover_asset_view_insert"();
