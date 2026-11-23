"use client";

import { useCallback, useId, useState, type ReactNode } from "react";
import { AnswerMenu } from "@/components/answer-actions";
import { useT } from "@/components/i18n-provider";
import { PageKindIcon } from "@/components/page-kind-icon";
import { PAGE_KIND_LABELS, type PageKind } from "@/lib/page-kinds";

// 新しいページを作るボタン（#168）。作れる種類（kinds、creatablePageKinds）が 1 つなら、押すとすぐその種類を作る
// （ノートしか作れない間は今までの「New note」と同じ 1 回の操作）。2 つ以上なら、押すと種類のメニュー（ノート・スライド・ホワイトボード）を開く。
// サイドバーの「新建」、プロジェクトの「+」、ページ行の「+」が使う。分区の「+」とホームの作成ボタンは種類が決まっているので使わない。
export function NewPageButton({ kinds, busy, onCreate, className, label, menuLabel, children }: {
  kinds: readonly PageKind[];
  busy: boolean;
  onCreate: (kind: PageKind) => void;
  className: string;
  // ボタンの読み上げ名と title（中身がアイコンだけのとき）。
  label?: string;
  // 種類のメニューの読み上げ名。
  menuLabel: string;
  children: ReactNode;
}) {
  const t = useT();
  const id = useId();
  const [menu, setMenu] = useState<{ anchor: DOMRect; trigger: HTMLButtonElement; focusLast: boolean } | null>(null);
  const multiple = kinds.length > 1;
  // AnswerMenu は onClose が変わると開き直すので、同じ関数を渡し続ける。
  const close = useCallback(() => setMenu(null), []);
  return <>
    <button type="button" className={className} disabled={busy} aria-label={label} title={label}
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
        <PageKindIcon kind={kind} size={16} aria-hidden="true" />{t(PAGE_KIND_LABELS[kind])}
      </button>)}
    </AnswerMenu>}
  </>;
}
