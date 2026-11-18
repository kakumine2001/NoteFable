import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { I18nProvider, useI18n } from "@/components/i18n-provider";
import { sideMenuPlacementFor, submenuPositionFor } from "@/components/note-editor";
import { loginEmailContent } from "@/lib/email-login";
import { landingTitle } from "./landing-meta";
import { LOCALES } from "./locale";
import { messagesFor } from "./messages";
import { createTranslator } from "./translate";

function Probe() {
  const { locale, dir, t } = useI18n();
  return <span data-probe={`${locale}:${dir}`}>{t("Settings")}</span>;
}

describe("RTL and multi-script presentation", () => {
  it("renders I18nProvider with dir=rtl for Arabic and dir=ltr for LTR locales", () => {
    const arHtml = renderToStaticMarkup(
      <I18nProvider locale="ar" messages={messagesFor("ar")}>
        <Probe />
      </I18nProvider>,
    );
    expect(arHtml).toContain('lang="ar"');
    expect(arHtml).toContain('dir="rtl"');
    expect(arHtml).toContain('data-probe="ar:rtl"');
    expect(arHtml).toContain(messagesFor("ar")["Settings"]);

    const frHtml = renderToStaticMarkup(
      <I18nProvider locale="fr" messages={messagesFor("fr")}>
        <Probe />
      </I18nProvider>,
    );
    expect(frHtml).toContain('lang="fr"');
    expect(frHtml).toContain('dir="ltr"');
    expect(frHtml).toContain('data-probe="fr:ltr"');
  });

  it("joins landing titles without an ASCII space only for CJK locales (zh, zh-Hant, ja)", () => {
    for (const locale of LOCALES) {
      const t = createTranslator(messagesFor(locale));
      const title = landingTitle(t, locale);
      const expectedSeparator = locale === "zh" || locale === "zh-Hant" || locale === "ja" ? "" : " ";
      expect(title, locale).toBe(`NoteFable — ${[t("Ask it."), t("Keep it."), t("Find it again.")].join(expectedSeparator)}`);
    }
  });

  it("formats login emails with dir=rtl for Arabic while keeping the 6-digit OTP code LTR", () => {
    const arEmail = loginEmailContent("482910", "ar");
    expect(arEmail.html).toContain('lang="ar" dir="rtl"');
    expect(arEmail.html).toContain('<p dir="ltr" style="font-size:28px');
    expect(arEmail.html).toContain(">482910</p>");
    expect(arEmail.subject).toContain("482910");

    const koEmail = loginEmailContent("482910", "ko");
    expect(koEmail.html).toContain('lang="ko" dir="ltr"');
    expect(koEmail.html).toContain('<p dir="ltr" style="font-size:28px');
  });

  it("places BlockNote side-menu controls and submenus according to text direction and neutralizes physical left-side styles in RTL", () => {
    expect(sideMenuPlacementFor("ltr")).toBe("left-start");
    expect(sideMenuPlacementFor("rtl")).toBe("right-start");
    expect(submenuPositionFor("ltr")).toBe("right");
    expect(submenuPositionFor("rtl")).toBe("left");

    const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
    // RTL overrides neutralize BlockNote's physical left margin, quote border-left, list marker padding-right, and toggle add-block margin-left.
    expect(css).toMatch(/\[dir="rtl"\]\s+\.notes-block-editor\s+\.bn-block-group\s+\.bn-block-group\s*\{[^}]*margin-left:\s*0;[^}]*margin-inline-start:\s*24px;/);
    expect(css).toMatch(/\[dir="rtl"\]\s+\.notes-block-editor\s+\.bn-block-content\[data-content-type="quote"\]\s+blockquote\s*\{[^}]*border-left:\s*0;[^}]*border-inline-end:\s*0;[^}]*border-inline-start:\s*3px solid currentColor;/);
    expect(css).toMatch(/\[dir="rtl"\]\s+\.notes-block-editor\s+\.bn-block-content\[data-content-type="bulletListItem"\]::before,[\s\S]*?padding-right:\s*0;[^}]*padding-inline-end:\s*4px;/);
    expect(css).toMatch(/\[dir="rtl"\]\s+\.notes-block-editor\s+\.bn-block-content\s+\.bn-toggle-add-block-button\s*\{[^}]*margin-left:\s*0;[^}]*margin-inline-start:\s*26px;/);
  });
});
