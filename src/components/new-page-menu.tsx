"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { AnswerMenu } from "@/components/answer-actions";
import { useT } from "@/components/i18n-provider";
import { PageKindIcon } from "@/components/page-kind-icon";
import { msg } from "@/lib/i18n/translate";
import { PAGE_KIND_FEATURES, PAGE_KIND_LABELS, PAGE_KINDS, type PageKind } from "@/lib/page-kinds";

// 新しく作れるページの種類（エディターがある種類だけ。PAGE_KIND_FEATURES の editor）。スライド（#149）はエディターができたら自動で並ぶ。
export const CREATABLE_PAGE_KINDS: readonly PageKind[] = PAGE_KINDS.filter((kind) => PAGE_KIND_FEATURES[kind].editor);

// 「新しい○○」の文言（ボタン・メニューの項目）。
export const NEW_PAGE_LABELS: Record<PageKind, string> = {
  note: msg("New note"),
  whiteboard: msg("New whiteboard"),
  slides: msg("New slide deck"),
};

// サイドバーの「New note」の隣の ▾：ページの種類を選んで作る。
export function NewPageKindMenu({ busy, onCreate, className = "" }: { busy: boolean; onCreate: (kind: PageKind) => void; className?: string }) {
  const t = useT();
  const id = useId();
  const [menu, setMenu] = useState<{ anchor: DOMRect; trigger: HTMLButtonElement } | null>(null);
  if (CREATABLE_PAGE_KINDS.length < 2) return null;
  const close = () => setMenu(null);
  return <>
    <button type="button" className={className} disabled={busy} aria-haspopup="menu" aria-expanded={!!menu} aria-controls={id}
      aria-label={t("Choose a page type")} title={t("Choose a page type")}
      onClick={(event) => setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget })}>
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {menu && <AnswerMenu id={id} label={t("Choose a page type")} className="new-page-menu" anchor={menu.anchor} trigger={menu.trigger} focusLast={false} onClose={close}>
      {CREATABLE_PAGE_KINDS.map((kind) => <button key={kind} type="button" role="menuitem" className="chat-menu-item" onClick={() => { close(); onCreate(kind); }}>
        <PageKindIcon kind={kind} size={16} /><span className="flex-1">{t(PAGE_KIND_LABELS[kind])}</span>
      </button>)}
    </AnswerMenu>}
  </>;
}
