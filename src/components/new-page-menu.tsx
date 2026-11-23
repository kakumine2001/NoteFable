"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { AnswerMenu } from "@/components/answer-actions";
import { useT } from "@/components/i18n-provider";
import { PageKindIcon } from "@/components/page-kind-icon";
import { creatablePageKinds } from "@/lib/canvas-save";
import { PAGE_KIND_LABELS, type PageKind } from "@/lib/page-kinds";

// 「New note」の横に付ける、ほかの種類（スライド・ホワイトボード）を作るメニュー。
// エディターがある種類だけを並べる（PAGE_KIND_FEATURES の editor）。ノートしか作れないあいだは何も出さない。
// 「New note」自体はこれまでどおり 1 回の操作でノートを作る。
export function NewPageKindMenu({ busy, onCreate, className = "" }: { busy: boolean; onCreate: (kind: PageKind) => void; className?: string }) {
  const t = useT();
  const id = useId();
  const [menu, setMenu] = useState<{ anchor: DOMRect; trigger: HTMLButtonElement; focusLast: boolean } | null>(null);
  // 親の再描画（自動保存の状態の変化など）でメニューが開き直らないよう、同じ関数を渡し続ける。
  const close = useCallback(() => setMenu(null), []);
  const kinds = creatablePageKinds();
  if (kinds.length < 2) return null;
  return <>
    <button type="button" className={`new-page-kind-trigger ${className}`} disabled={busy} aria-label={t("New page")} title={t("New page")}
      aria-haspopup="menu" aria-expanded={!!menu} aria-controls={id}
      onClick={(event) => setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, focusLast: false })}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, focusLast: event.key === "ArrowUp" });
      }}>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    {menu && <AnswerMenu id={id} label={t("New page")} className="new-page-kind-menu" anchor={menu.anchor} trigger={menu.trigger} focusLast={menu.focusLast} onClose={close}>
      {kinds.map((kind) => <button key={kind} type="button" role="menuitem" className="chat-menu-item" onClick={() => { close(); onCreate(kind); }}>
        <PageKindIcon kind={kind} size={16} aria-hidden="true" />{t(PAGE_KIND_LABELS[kind])}
      </button>)}
    </AnswerMenu>}
  </>;
}
