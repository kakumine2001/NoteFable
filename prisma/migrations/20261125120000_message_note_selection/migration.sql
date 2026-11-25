-- Persist split-view canvas selection IDs on MessageNote so regenerating, editing, or forking a turn retains the selected element/slide focus.
-- Additive: nullable column; existing rows keep null.

-- AlterTable
ALTER TABLE "MessageNote" ADD COLUMN "selectionIds" TEXT;
