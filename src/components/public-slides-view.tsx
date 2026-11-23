import { I18nProvider } from "@/components/i18n-provider";
import { PublicMathStyles } from "@/components/public-note-math-styles";
import { PublicSlidesPlayer } from "@/components/slides/public-slides-player";
import { siteHref } from "@/lib/hosts";
import { localeDir, type Locale } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";
import { renderKatex, type KatexApi } from "@/lib/katex-render";
import type { ResolvedPublicShare } from "@/lib/note-share-server";
import { deckMathKeys, publicDeck } from "@/lib/slides/public-deck";

// スライドの公開ページ（/s/:token と、公開中のノートの下のスライド /s/:token/p/:id）。読み取り専用の放映。
// 隠した枚・演説者ノートは送らない（publicDeck）。数式はサーバーで描き、ブラウザでは KaTeX を読み込まない（ノートの公開ページと同じ）。
async function loadKatex(): Promise<KatexApi | null> {
  try {
    const mod = await import("katex");
    return (mod.default ?? mod) as KatexApi;
  } catch (error) {
    console.error("[public-slides] failed to load KaTeX", error);
    return null;
  }
}

export async function PublicSlidesView({ data, locale }: { data: ResolvedPublicShare; locale: Locale }) {
  const deck = publicDeck(data.page.data);
  const keys = deckMathKeys(deck);
  const katex = keys.length ? await loadKatex() : null;
  const mathHtml: Record<string, string> = {};
  if (katex) for (const key of keys) {
    const { html } = renderKatex(katex, key.slice(2), key.startsWith("d:"));
    if (html) mathHtml[key] = html;
  }
  return <I18nProvider locale={locale} messages={messagesFor(locale)}>
    <div className="public-slides-shell" lang={locale} dir={localeDir(locale)}>
      {katex ? <PublicMathStyles /> : null}
      <PublicSlidesPlayer deck={deck} mathHtml={mathHtml} token={data.token} pageId={data.page.id} title={data.page.title} homeHref={siteHref("/?intro")} />
    </div>
  </I18nProvider>;
}
