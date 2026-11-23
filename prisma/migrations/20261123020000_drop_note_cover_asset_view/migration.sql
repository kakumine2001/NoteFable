-- 20261123010000_note_cover_asset_view の互換ビューを消す。そのビューは 20261123000000_stored_files の公開中に
-- 動いていた前のデプロイのためだけのもので、今のコードは StoredFile しか使わない（20261115010000_drop_anonymous_user_view と同じ手順）。
-- ビューを消すとその INSTEAD OF トリガーも消える。トリガーの関数は別に消す。
DROP VIEW IF EXISTS "NoteCoverAsset";
DROP FUNCTION IF EXISTS "note_cover_asset_view_insert"();
