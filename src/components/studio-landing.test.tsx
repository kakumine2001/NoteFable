import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { generateMetadata } from "@/app/[locale]/page";
import { I18nProvider } from "@/components/i18n-provider";
import { ModelsProvider } from "@/components/models-provider";
import { StudioLanding } from "@/components/studio-landing";
import { CHARACTER_DEFINITIONS } from "@/lib/characters";
import { LANDING_HERO } from "@/lib/i18n/landing-meta";
import { LOCALES, type Locale } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";
import { createTranslator } from "@/lib/i18n/translate";
import { publicModels } from "@/lib/model-registry";

function renderLanding(locale: Locale) {
  return renderToStaticMarkup(
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      <ModelsProvider models={publicModels()}>
        <StudioLanding />
      </ModelsProvider>
    </I18nProvider>,
  );
}

function escapeHtmlText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}

describe("StudioLanding hero English pinning and i18n coverage", () => {
  it("renders the three hero lines in English across all 17 locales while localizing surrounding landing copy", () => {
    const models = publicModels();
    for (const locale of LOCALES) {
      const html = renderLanding(locale);
      const dict = messagesFor(locale);
      const t = createTranslator(dict);

      expect(html, `${locale}: eyebrow`).toContain(
        `<p class="lp-eyebrow" lang="en" dir="ltr"><i class="lp-eyebrow-dot" aria-hidden="true"></i><span>${escapeHtmlText(LANDING_HERO.eyebrow)}</span></p>`,
      );
      expect(html, `${locale}: headline + highlight`).toContain(
        '<h1 id="lp-title" lang="en" dir="ltr"><span class="lp-rise">Ask it.</span> <span class="lp-rise"><span class="lp-mark">Keep it.</span></span><br/><span class="lp-rise">Find it again.</span></h1>',
      );
      expect(html, `${locale}: lede`).toContain(
        `<p class="lp-lede" lang="en" dir="ltr">${escapeHtmlText(LANDING_HERO.lede)}</p>`,
      );

      // Neighbouring strings across every section still localize cleanly.
      expect(html, `${locale}: nav CTA`).toContain(escapeHtmlText(t("Open NoteFable")));
      expect(html, `${locale}: workspace section`).toContain(escapeHtmlText(t("Three canvases, one Workspace.")));
      expect(html, `${locale}: AI section`).toContain(escapeHtmlText(t("AI that builds with you, never behind your back.")));
      expect(html, `${locale}: study section`).toContain(escapeHtmlText(t("Turn notes into active recall. Find anything instantly.")));
      expect(html, `${locale}: companions section`).toContain(escapeHtmlText(t("Seven animated companions, synced across every device.")));
      expect(html, `${locale}: finale`).toContain(escapeHtmlText(t("What is the question you keep coming back to?")));
      expect(html, `${locale}: footer`).toContain(escapeHtmlText(t("Privacy")));

      // Server-configured models and all 7 companions are rendered.
      for (const model of models.models) {
        expect(html, `${locale}: model ${model.id}`).toContain(escapeHtmlText(model.label));
      }
      for (const character of CHARACTER_DEFINITIONS) {
        expect(html, `${locale}: companion ${character.id}`).toContain(escapeHtmlText(character.name));
      }
    }
  });

  it("pins landing metadata <title> to English across all 17 locales while keeping meta description localized", async () => {
    for (const locale of LOCALES) {
      const t = createTranslator(messagesFor(locale));
      const meta = await generateMetadata({ params: Promise.resolve({ locale }) });
      expect(meta.title, `${locale}: metadata.title`).toBe("NoteFable — Ask it. Keep it. Find it again.");
      expect(meta.description, `${locale}: metadata.description`).toBe(
        t("AI chat with notes, slides and whiteboards in one place: ask a question, keep the answer as a note in your Workspace, and find it all again later."),
      );
    }
  });
});
