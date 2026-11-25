"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { useT } from "@/components/i18n-provider";
import { extractTocHeadings } from "@/lib/note-toc";
import { revealNoteBlock } from "@/lib/search-reveal";

/**
 * Notion の画面右端にある常設アウトライン（ミニ目次）。
 * 普段はコンパクトな横棒インジケーターだけを浮かべ、ホバーまたはフォーカスでクリック可能な見出し一覧を開く。
 */
export function NoteFloatingToc({
  blocks,
  scrollRootRef,
  activeId,
}: {
  blocks: unknown;
  scrollRootRef: RefObject<HTMLElement | null>;
  activeId: string;
}) {
  const t = useT();
  const headings = useMemo(() => extractTocHeadings(blocks), [blocks]);
  const [currentId, setCurrentId] = useState<string | null>(() => headings[0]?.id ?? null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!headings.length || !root) return;

    let raf = 0;
    const headingIds = new Set(headings.map((h) => h.id));

    const updateCurrent = () => {
      raf = 0;
      const rootTop = root.getBoundingClientRect().top;
      const threshold = rootTop + 120;
      const elements = root.querySelectorAll<HTMLElement>(".notes-block-editor .bn-block-outer[data-id]");
      let activeHeading: string | null = null;
      let activeTop = Number.NEGATIVE_INFINITY;
      let firstVisibleId: string | null = null;
      let firstVisibleTop = Number.POSITIVE_INFINITY;
      for (const el of elements) {
        const id = el.dataset.id;
        if (!id || !headingIds.has(id)) continue;
        // 折りたたまれたトグル内など、画面に配置されていない見出しは無視する。
        if (el.getClientRects().length === 0) continue;
        const top = el.getBoundingClientRect().top;
        if (top < firstVisibleTop) {
          firstVisibleTop = top;
          firstVisibleId = id;
        }
        // トグル内や段組みで DOM 順が画面の上下順とずれても、最も近い見出しを選ぶため途中で打ち切らない。
        if (top <= threshold && top >= activeTop) {
          activeTop = top;
          activeHeading = id;
        }
      }
      setCurrentId(activeHeading ?? firstVisibleId ?? headings[0].id);
    };

    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(updateCurrent);
    };

    schedule();
    root.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      root.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [headings, scrollRootRef, activeId]);

  if (!headings.length) return null;

  const minLevel = headings.reduce((min, h) => Math.min(min, h.level), 3);
  const resolvedCurrent = headings.some((h) => h.id === currentId) ? currentId : headings[0].id;

  return (
    <aside
      className={`notes-floating-toc${open ? " is-open" : ""}`}
      aria-label={t("Table of contents")}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className="notes-floating-toc-bars"
        aria-label={t("Table of contents")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {headings.map((item) => (
          <span
            key={item.id}
            aria-hidden="true"
            className={`notes-floating-toc-bar${resolvedCurrent === item.id ? " is-active" : ""}`}
            data-level={item.level}
          />
        ))}
      </button>
      <nav className="notes-floating-toc-panel" aria-label={t("Table of contents")}>
        <ul className="notes-floating-toc-list">
          {headings.map((item) => {
            const active = resolvedCurrent === item.id;
            return (
              <li
                key={item.id}
                className="notes-floating-toc-item"
                style={{ paddingInlineStart: `${(item.level - minLevel) * 12}px` }}
              >
                <button
                  type="button"
                  className={`notes-floating-toc-link${active ? " is-active" : ""}`}
                  aria-current={active ? "location" : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setCurrentId(item.id);
                    setOpen(false);
                    void revealNoteBlock(item.id);
                  }}
                >
                  {item.text}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
