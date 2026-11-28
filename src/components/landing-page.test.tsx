import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { generateMetadata } from "@/app/[locale]/page";
import { I18nProvider } from "@/components/i18n-provider";
import { LandingPage } from "@/components/landing-page";
import { ModelsProvider } from "@/components/models-provider";
import { LOCALES, type Locale } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";
import { createTranslator } from "@/lib/i18n/translate";
import { publicModels } from "@/lib/model-registry";

function renderLanding(locale: Locale) {
  return renderToStaticMarkup(
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      <ModelsProvider models={publicModels()}>
        <LandingPage />
      </ModelsProvider>
    </I18nProvider>,
  );
}

function escapeHtmlText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}

// 見出しは単語ごとの <span> に分かれる。タグを外して、読める文として比べる。
function textOf(html: string, pattern: RegExp) {
  return (html.match(pattern)?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

describe("LandingPage hero English pinning", () => {
  it("renders the hero in English across all 17 locales while localizing the rest of the page", () => {
    for (const locale of LOCALES) {
      const html = renderLanding(locale);
      const t = createTranslator(messagesFor(locale));

      expect(textOf(html, /<p class="lp-eyebrow" lang="en" dir="ltr">(.*?)<\/p>/), `${locale}: eyebrow`).toBe("AI chat with a Workspace built in");
      expect(textOf(html, /<h1 id="lp-title" lang="en" dir="ltr">(.*?)<\/h1>/), `${locale}: headline`).toBe("Ask anything. Make it yours.");
      expect(html, `${locale}: lede`).toContain(
        `<p class="lp-lede" lang="en" dir="ltr">${escapeHtmlText("NoteFable is the AI chat that doesn't end in a chat log. Turn any answer into notes, slides and whiteboards, then pick up right where you left off.")}</p>`,
      );

      // Everything around the hero follows the display language.
      expect(html, `${locale}: nav CTA`).toContain(escapeHtmlText(t("Open NoteFable")));
      expect(html, `${locale}: hero note`).toContain(escapeHtmlText(t("Free to start. No account needed.")));
      expect(html, `${locale}: flow heading`).toContain(escapeHtmlText(t("One question, all the way through.")));
      expect(html, `${locale}: review step`).toContain(escapeHtmlText(t("Quiz yourself before you forget.")));
      expect(html, `${locale}: proposal card`).toContain(escapeHtmlText(t("{op} · start of note", { op: t("Insert") })));
      expect(html, `${locale}: features heading`).toContain(escapeHtmlText(t("More than a chat window.")));
      expect(html, `${locale}: language count`).toContain(escapeHtmlText(t("{count} languages, light and dark.", { count: LOCALES.length })));
      expect(html, `${locale}: finale`).toContain(escapeHtmlText(t("What is the question you keep coming back to?")));
      expect(html, `${locale}: footer`).toContain(escapeHtmlText(t("Privacy")));
    }
  });

  it("shows every flow sample before scripts run, so the page reads without JavaScript", () => {
    const html = renderLanding("en");
    expect(html.match(/class="lp-flow-panel[^"]*" data-live="true"/g)).toHaveLength(4);
    expect(html).not.toContain('data-live="false"');
  });

  it("pins landing metadata <title> to English across all 17 locales while keeping meta description localized", async () => {
    for (const locale of LOCALES) {
      const t = createTranslator(messagesFor(locale));
      const meta = await generateMetadata({ params: Promise.resolve({ locale }) });
      expect(meta.title, `${locale}: metadata.title`).toBe("NoteFable — Ask anything. Make it yours.");
      expect(meta.description, `${locale}: metadata.description`).toBe(
        t("AI chat with notes, slides and whiteboards in one place: ask a question, keep the answer as a note in your Workspace, and find it all again later."),
      );
    }
  });
});
