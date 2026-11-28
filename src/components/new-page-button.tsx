"use client";

import { Upload } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnswerMenu } from "@/components/answer-actions";
import { AppIcon } from "@/components/app-icon";
import { useT } from "@/components/i18n-provider";
import { PageKindIcon } from "@/components/page-kind-icon";
import { PAGE_KIND_LABELS, PAGE_KIND_NEW_LABELS, type PageKind } from "@/lib/page-kinds";

// 新しいページを作るボタン（#168）。作れる種類（kinds、creatablePageKinds）が 1 つで追加メニューも無ければ押すとすぐ作成。
// 2 つ以上、または onGenerate / onImportPptx があるときはメニューを開く。
// サイドバーの「新建」、プロジェクトの「+」、ページ行の「+」、各分区（ノート・ホワイトボード・スライド）の「+」が使う。
// onGenerate はすべての種類で「Generate with AI」を出し、onImportPptx はスライドを作れる所だけで「Import PowerPoint」を出す。
// onOpenChange はメニューの開閉を知らせる（行の「+」で開いている間、その行の操作ボタンを出したままにする）。
export function NewPageButton({ kinds, busy, onCreate, onGenerate, onImportPptx, onOpenChange, className, label, title = label, menuLabel, children }: {
  kinds: readonly PageKind[];
  busy: boolean;
  onCreate: (kind: PageKind) => void;
  onGenerate?: () => void;
  onImportPptx?: () => void;
  onOpenChange?: (open: boolean) => void;
  className: string;
  // ボタンの読み上げ名（中身がアイコンだけのとき）と、ツールチップ（省略は label）。
  label?: string;
  title?: string;
  // 種類のメニューの読み上げ名。
  menuLabel: string;
  children: ReactNode;
}) {
  const t = useT();
  const id = useId();
  const [menu, setMenu] = useState<{ anchor: DOMRect; trigger: HTMLButtonElement; focusLast: boolean } | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);
  useEffect(() => { onOpenChangeRef.current?.(Boolean(menu)); }, [menu]);
  useEffect(() => () => { onOpenChangeRef.current?.(false); }, []);
  const generate = onGenerate ?? null;
  const importPptx = onImportPptx && kinds.includes("slides") ? onImportPptx : null;
  const multiple = kinds.length > 1 || generate !== null || importPptx !== null;
  // 種類が 1 つだけのメニュー（各分区）は「New note」「New whiteboard」「New slide deck」と作る操作の名前にする。
  const labels = kinds.length > 1 ? PAGE_KIND_LABELS : PAGE_KIND_NEW_LABELS;
  // AnswerMenu は onClose が変わると開き直すので、同じ関数を渡し続ける。
  const close = useCallback(() => setMenu(null), []);
  return <>
    <button type="button" className={className} disabled={busy} aria-label={label} title={title}
      aria-haspopup={multiple ? "menu" : undefined} aria-expanded={multiple ? !!menu : undefined} aria-controls={multiple && menu ? id : undefined}
      onClick={(event) => {
        if (!multiple) { onCreate(kinds[0] ?? "note"); return; }
        setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, focusLast: false });
      }}
      onKeyDown={(event) => {
        if (!multiple || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
        event.preventDefault();
        setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, focusLast: event.key === "ArrowUp" });
      }}>
      {children}
    </button>
    {menu && <AnswerMenu id={id} label={menuLabel} className="new-page-menu" anchor={menu.anchor} trigger={menu.trigger} focusLast={menu.focusLast} onClose={close}>
      {kinds.map((kind) => <button key={kind} type="button" role="menuitem" className="chat-menu-item" onClick={() => { close(); onCreate(kind); }}>
        <PageKindIcon kind={kind} size={16} aria-hidden="true" />{t(labels[kind])}
      </button>)}
      {(generate || importPptx) && <>
        <hr className="chat-menu-divider" />
        {generate && <button type="button" role="menuitem" className="chat-menu-item" aria-haspopup="dialog" onClick={() => { close(); generate(); }}>
          <AppIcon size={16} />{t("Generate with AI")}
        </button>}
        {importPptx && <button type="button" role="menuitem" className="chat-menu-item" aria-haspopup="dialog" onClick={() => { close(); importPptx(); }}>
          <Upload size={16} aria-hidden="true" />{t("Import PowerPoint")}
        </button>}
      </>}
    </AnswerMenu>}
  </>;
}
