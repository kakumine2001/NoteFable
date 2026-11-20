import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { generateMetadata } from "@/app/[locale]/page";
import { I18nProvider } from "@/components/i18n-provider";
import { ModelsProvider } from "@/components/models-provider";
import { ThreadLanding } from "@/components/thread-landing";
import { LOCALES, type Locale } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";
import { createTranslator } from "@/lib/i18n/translate";
import { publicModels } from "@/lib/model-registry";

function renderLanding(locale: Locale) {
  return renderToStaticMarkup(
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      <ModelsProvider models={publicModels()}>
        <ThreadLanding />
      </ModelsProvider>
    </I18nProvider>,
  );
}

function escapeHtmlText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}

describe("ThreadLanding hero English pinning", () => {
  it("renders the three hero lines in English across all 17 locales while localizing neighbouring landing copy", () => {
    for (const locale of LOCALES) {
      // 見出しは読点ごとに .tl-phrase で包まれるので、文面の照合はその span を外してから行う。
      const html = renderLanding(locale).replace(/<span class="tl-phrase">(.*?)<\/span>/g, "$1");
      const dict = messagesFor(locale);
      const t = createTranslator(dict);

      expect(html, `${locale}: eyebrow`).toContain(
        '<p class="tl-kicker" lang="en" dir="ltr">AI chat and notes, in one place</p>',
      );
      expect(html, `${locale}: headline + highlight`).toContain(
        '<h1 id="tl-title" lang="en" dir="ltr"><span class="tl-rise">Ask it.</span> <span class="tl-rise"><span class="tl-mark">Keep it.</span></span><br/><span class="tl-rise">Find it again.</span></h1>',
      );
      expect(html, `${locale}: lede`).toContain(
        '<p class="tl-lede" lang="en" dir="ltr">NoteFable is a study space where a question becomes an answer, the answer becomes a note, and the note is still there when you need it.</p>',
      );

      if (locale !== "en") {
        expect(html, `${locale}: eyebrow translation excluded`).not.toContain(escapeHtmlText(dict["AI chat and notes, in one place"]));
        expect(html, `${locale}: lede translation excluded`).not.toContain(
          escapeHtmlText(dict["NoteFable is a study space where a question becomes an answer, the answer becomes a note, and the note is still there when you need it."]),
        );
      }

      // Neighbouring strings right above and below the hero (and throughout the page) still localize.
      expect(html, `${locale}: nav CTA`).toContain(escapeHtmlText(t("Open workspace")));
      expect(html, `${locale}: composer aria-label`).toContain(escapeHtmlText(t("Open NoteFable and ask a question")));
      expect(html, `${locale}: hero note`).toContain(escapeHtmlText(t("Click the box to start. No account needed.")));
      expect(html, `${locale}: station 05 title`).toContain(escapeHtmlText(t("Find it again, however you typed it.")));
      expect(html, `${locale}: finale`).toContain(escapeHtmlText(t("What is the question you keep coming back to?")));
      expect(html, `${locale}: footer`).toContain(escapeHtmlText(t("Privacy")));
    }
  });

  it("pins landing metadata <title> to English across all 17 locales while keeping meta description localized", async () => {
    for (const locale of LOCALES) {
      const t = createTranslator(messagesFor(locale));
      const meta = await generateMetadata({ params: Promise.resolve({ locale }) });
      expect(meta.title, `${locale}: metadata.title`).toBe("NoteFable — Ask it. Keep it. Find it again.");
      expect(meta.description, `${locale}: metadata.description`).toBe(
        t("AI chat and notes in one place: ask a question, keep the answer as a note, and find it again later."),
      );
    }
  });
});
