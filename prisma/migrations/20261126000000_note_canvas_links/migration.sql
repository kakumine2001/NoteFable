-- Backlinks (#189): whiteboard and slide bodies are large, so the in-app page links they hold are extracted into their own
-- column on every save (extractCanvasLinks in src/lib/note-backlinks.ts) and backlinks read only that column.
-- Additive: a new column, filled below for existing bodies with the same rules. Only rows that hold a page link are updated.

-- AlterTable
ALTER TABLE "NoteCanvas" ADD COLUMN     "links" JSONB NOT NULL DEFAULT '[]';

-- Backfill whiteboards: element links and page cards of elements that are still shown.
UPDATE "NoteCanvas" c SET "links" = COALESCE((
  SELECT jsonb_agg(DISTINCT v."href")
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c."data" -> 'elements') = 'array' THEN c."data" -> 'elements' ELSE '[]'::jsonb END) AS e("element")
  CROSS JOIN LATERAL (VALUES
    (CASE WHEN jsonb_typeof(e."element" -> 'link') = 'string' THEN e."element" ->> 'link' END),
    (CASE WHEN jsonb_typeof(e."element" #> '{customData,notefablePage,id}') = 'string' AND (e."element" #>> '{customData,notefablePage,id}') ~ '^[A-Za-z0-9_-]{1,64}$'
      THEN '/app?view=pages&page=' || (e."element" #>> '{customData,notefablePage,id}') END)
  ) AS v("href")
  WHERE jsonb_typeof(e."element" -> 'id') = 'string'
    AND e."element" ->> 'type' IN ('rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'image', 'frame', 'stickynote')
    AND e."element" -> 'isDeleted' IS DISTINCT FROM 'true'::jsonb
    AND strpos(v."href", 'view=pages') > 0 AND length(v."href") <= 2048
), '[]'::jsonb)
FROM "NotePage" p
WHERE p."id" = c."noteId" AND p."kind" = 'whiteboard' AND c."data"::text ~ 'view=pages|notefablePage';

-- Backfill slides: link marks in slide text.
UPDATE "NoteCanvas" c SET "links" = COALESCE((
  SELECT jsonb_agg(DISTINCT h)
  FROM jsonb_array_elements_text(jsonb_path_query_array(c."data",
    'strict $.slides.** ? (@.type() == "object" && @.type == "link" && exists(@.attrs.href)).attrs.href', '{}'::jsonb, true)) AS h
  WHERE strpos(h, 'view=pages') > 0 AND length(h) <= 2048
), '[]'::jsonb)
FROM "NotePage" p
WHERE p."id" = c."noteId" AND p."kind" = 'slides' AND strpos(c."data"::text, 'view=pages') > 0;
