"use client";

import { defaultProps } from "@blocknote/core";
import { createReactBlockSpec, useEditorChange } from "@blocknote/react";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { extractTocHeadings, sameTocHeadings, type TocHeading } from "@/lib/note-toc";
import { revealNoteBlock } from "@/lib/search-reveal";

function TocBlock({ initialHeadings }: { initialHeadings: TocHeading[] }) {
  const t = useT();
  const [headings, setHeadings] = useState<TocHeading[]>(initialHeadings);

  useEditorChange((ed) => {
    const next = extractTocHeadings(ed.document);
    setHeadings((prev) => (sameTocHeadings(prev, next) ? prev : next));
  });

  const minLevel = headings.reduce((min, h) => Math.min(min, h.level), 3);

  return (
    <nav className="notes-toc" contentEditable={false} aria-label={t("Table of contents")}>
      {headings.length ? (
        <ul className="notes-toc-list">
          {headings.map((item) => (
            <li
              key={item.id}
              className="notes-toc-item"
              data-level={item.level}
              style={{ paddingInlineStart: `${(item.level - minLevel) * 14}px` }}
            >
              <button
                type="button"
                className="notes-toc-link"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void revealNoteBlock(item.id)}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="notes-toc-empty">{t("Add headings to create a table of contents.")}</p>
      )}
    </nav>
  );
}

/** Notion 風のページ内目次ブロック（/table of contents / /toc）。見出しの追加・編集・並び替えにリアルタイムで追従する。 */
export const createTocBlockSpec = createReactBlockSpec(
  {
    type: "tableOfContents",
    propSchema: {
      textColor: defaultProps.textColor,
      backgroundColor: defaultProps.backgroundColor,
    },
    content: "none",
  },
  {
    render: function TableOfContentsBlock({ editor }) {
      return <TocBlock initialHeadings={extractTocHeadings(editor.document)} />;
    },
  },
);
