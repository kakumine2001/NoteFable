"use client";

import { Check, ChevronRight, Copy } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

// リンクの href や location.hash（"#heading-…"）から、このページ内で指している要素の id を取り出す。ページ内のリンクでなければ null。
export function hashTargetId(href: string | null | undefined, here: string): string | null {
  if (!href) return null;
  const hashIndex = href.indexOf("#");
  if (hashIndex < 0) return null;
  // 別のページへのリンク（"/s/…#…" など）は対象にしない。
  if (hashIndex > 0) {
    try {
      const target = new URL(href, here);
      const current = new URL(here);
      if (target.origin !== current.origin || target.pathname !== current.pathname || target.search !== current.search) return null;
    } catch { return null; }
  }
  const raw = href.slice(hashIndex + 1);
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

type RevealWindow = Pick<Window, "addEventListener" | "removeEventListener"> & { location: Pick<Location, "hash" | "href"> };
type RevealDocument = Pick<Document, "addEventListener" | "removeEventListener" | "getElementById">;
type Subscriber = { ids: ReadonlySet<string>; open: (id: string) => void };

// 閉じたトグルの中の見出しへのリンク（目次・URL の #heading-…）を開くための仕組み。ページに 1 つ。
// 指された見出しが画面に無ければ（閉じたトグルの中）、それを含むトグルを開いてもらい、描かれたらスクロールする。
// 入れ子のトグルは、外側が開いて描いた内側のトグルが登録したときに、まだ果たしていない指定（pending）を見て続けて開く。
// 見出しまでスクロールしたら指定を消す（後で手で閉じて開き直したときに、勝手に開いたりスクロールしたりしない）。
export function createHeadingRevealer(win: RevealWindow, doc: RevealDocument) {
  const subscribers = new Set<Subscriber>();
  let pending: string | null = null;
  let listening = false;

  function request(id: string | null) {
    // ページ内の見出し以外へのリンクや画面にある見出しは、ブラウザに任せる（前の指定も残さない）。
    if (!id || doc.getElementById(id)) {
      pending = null;
      return;
    }
    pending = id;
    for (const subscriber of [...subscribers]) if (subscriber.ids.has(id)) subscriber.open(id);
  }
  const onHashChange = () => request(hashTargetId(win.location.hash, win.location.href));
  const onClick = (event: Event) => {
    const mouse = event as MouseEvent;
    // 新しいタブで開く操作などはブラウザに任せる。
    if (mouse.defaultPrevented || mouse.button > 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
    const target = event.target as { closest?: (selector: string) => Element | null } | null;
    const link = typeof target?.closest === "function" ? target.closest("a[href*='#']") : null;
    if (!link) return;
    // 別のタブ・窓で開くリンク（target="_blank" など）は、この画面のトグルを開かない。
    const opensIn = link.getAttribute("target");
    if (opensIn && opensIn !== "_self") return;
    // 同じハッシュをもう一度押したときは hashchange が来ないので、クリックでも見る。
    request(hashTargetId(link.getAttribute("href"), win.location.href));
  };

  return {
    // ids はトグルの中（入れ子のトグルの中も含む）にある見出しの要素 id。戻り値で登録を外す。
    subscribe(ids: readonly string[], open: (id: string) => void): () => void {
      const subscriber: Subscriber = { ids: new Set(ids), open };
      subscribers.add(subscriber);
      if (!listening) {
        listening = true;
        win.addEventListener("hashchange", onHashChange);
        doc.addEventListener("click", onClick);
        // 開いた時点の URL のハッシュ（共有されたリンクの #heading-…）。
        onHashChange();
      } else if (pending && subscriber.ids.has(pending)) {
        open(pending);
      }
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size || !listening) return;
        // 別のページへ移った（トグルが全部無くなった）。果たしていない指定を次のページへ持ち越さない。
        pending = null;
        listening = false;
        win.removeEventListener("hashchange", onHashChange);
        doc.removeEventListener("click", onClick);
      };
    },
    // トグルが開いて描かれた後に呼ぶ。見出しが描かれていればスクロールして指定を果たす。
    scrollTo(id: string) {
      const element = doc.getElementById(id);
      if (!element) return;
      element.scrollIntoView();
      if (pending === id) pending = null;
    },
  };
}

let revealer: ReturnType<typeof createHeadingRevealer> | null = null;
function headingRevealer() {
  revealer ??= createHeadingRevealer(window, document);
  return revealer;
}

// 閉じている間は中身を描かない。revealIds（中にある見出しの要素 id）が目次のリンクや URL のハッシュで指されたら開き、
// 見出しまでスクロールする（createHeadingRevealer）。
export function PublicToggleBlock({
  header,
  children,
  className = "",
  revealIds,
}: {
  header: ReactNode;
  children?: ReactNode;
  className?: string;
  revealIds?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  // 開いた理由になった見出し（スクロール先）。同じ見出しをもう一度指したときもスクロールし直すよう、毎回新しい値にする。
  const [reveal, setReveal] = useState<{ id: string } | null>(null);
  const headerId = useId();
  const revealKey = revealIds?.join(" ") ?? "";
  useEffect(() => {
    if (!revealKey) return;
    let active = true;
    let stop = () => {};
    // 描いた後に見る（サーバーで描いた閉じた状態と食い違わないように、開くのは読み込み後）。
    queueMicrotask(() => {
      if (!active) return;
      stop = headingRevealer().subscribe(revealKey.split(" "), (id) => {
        setOpen(true);
        setReveal({ id });
      });
    });
    return () => { active = false; stop(); };
  }, [revealKey]);
  useEffect(() => {
    if (!reveal) return;
    // 開いて中身が描かれてから探す。入れ子の内側がまだ閉じていて見つからなければ、その内側のトグルが開いたときにスクロールする。
    const frame = window.requestAnimationFrame(() => headingRevealer().scrollTo(reveal.id));
    return () => window.cancelAnimationFrame(frame);
  }, [reveal]);
  return (
    <div className={`public-note-toggle ${open ? "is-open" : ""} ${className}`}>
      <div className="public-note-toggle-row">
        <button
          type="button"
          className="public-note-toggle-btn"
          aria-expanded={open}
          aria-labelledby={headerId}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <div id={headerId} className="public-note-toggle-header">{header}</div>
      </div>
      {open && children ? <div className="public-note-children">{children}</div> : null}
    </div>
  );
}

export function PublicCodeBlock({
  code,
  language,
  copyLabel,
  copiedLabel,
}: {
  code: string;
  language: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in restricted contexts.
    }
  }

  const label = language && language !== "text" ? language : "Plain Text";
  return (
    <div className="public-note-code" dir="ltr">
      <div className="public-note-code-bar">
        <span className="public-note-code-lang">{label}</span>
        <button type="button" className="public-note-code-copy" onClick={() => void onCopy()} aria-label={copied ? copiedLabel : copyLabel}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? copiedLabel : copyLabel}</span>
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
