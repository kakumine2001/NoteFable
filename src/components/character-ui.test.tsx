import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHARACTER_IDS } from "@/lib/characters";
import { messagesFor } from "@/lib/i18n/messages";

const mockLocale = { current: "en" as "en" | "ja" | "zh" | "ar" };
const mockSavedIcon = { current: null as string | null };

vi.mock("@/components/i18n-provider", () => ({
  useT: () => (key: string) => (mockLocale.current === "en" ? key : messagesFor(mockLocale.current)[key] ?? key),
  useI18n: () => ({
    locale: mockLocale.current,
    dir: mockLocale.current === "ar" ? "rtl" : "ltr",
    t: (key: string) => (mockLocale.current === "en" ? key : messagesFor(mockLocale.current)[key] ?? key),
  }),
}));

vi.mock("@/components/models-provider", () => ({
  useModels: () => ({
    defaultModel: "gpt-6-luna",
    options: [{ id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai", reasoningEfforts: ["medium"], defaultReasoning: "medium", supportsImageInput: true, supportsWebSearch: true, supportsPageTools: true }],
    getModelOption: () => ({ id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai", reasoningEfforts: ["medium"], defaultReasoning: "medium", supportsImageInput: true, supportsWebSearch: true, supportsPageTools: true }),
  }),
}));

vi.mock("@/lib/app-icon", async (original) => {
  const actual = await original<typeof import("@/lib/app-icon")>();
  return {
    ...actual,
    useAppIcon: () => mockSavedIcon.current,
    useResolvedAppIcon: () => actual.resolveAppIcon(mockSavedIcon.current),
  };
});

import { AppIcon, NoteFableLogo } from "./app-icon";
import { AppIconSettings } from "./app-icon-settings";
import { ChatMessage } from "./chat-message";
import { Mascot } from "./mascot";

describe("product-wide character touchpoints & AI reply de-branding", () => {
  beforeEach(() => {
    mockLocale.current = "en";
    mockSavedIcon.current = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders D · Quill by default across hero Mascot, sidebar NoteFableLogo, and AppIcon", () => {
    const mascotHtml = renderToStaticMarkup(createElement(Mascot, { state: "idle" }));
    const logoHtml = renderToStaticMarkup(createElement(NoteFableLogo));
    const iconHtml = renderToStaticMarkup(createElement(AppIcon, { size: 24, state: "thinking", animated: true }));

    expect(mascotHtml).toContain('data-character="quill"');
    expect(mascotHtml).toContain('data-state="idle"');
    expect(logoHtml).toContain('data-character="quill"');
    expect(logoHtml).toContain(">NoteFable<");
    expect(iconHtml).toContain('data-character="quill"');
    expect(iconHtml).toContain('data-state="thinking"');
    expect(iconHtml).toContain('data-animated="true"');
  });

  it("applies the user's chosen character or custom uploaded image across all touchpoints", () => {
    for (const id of CHARACTER_IDS) {
      mockSavedIcon.current = id === "quill" ? null : `character:${id}`;
      expect(renderToStaticMarkup(createElement(Mascot, { state: "typing" }))).toContain(`data-character="${id}"`);
      expect(renderToStaticMarkup(createElement(NoteFableLogo))).toContain(`data-character="${id}"`);
      expect(renderToStaticMarkup(createElement(AppIcon, { size: 28, state: "responding", animated: true }))).toContain(`data-character="${id}"`);
    }

    // Custom uploaded image stays static and does not claim preset character state attributes.
    const customUrl = "data:image/png;base64,AAAA";
    mockSavedIcon.current = customUrl;
    const customHero = renderToStaticMarkup(createElement(Mascot, { state: "thinking" }));
    const customIcon = renderToStaticMarkup(createElement(AppIcon, { size: 24, state: "thinking", animated: true }));
    expect(customHero).toContain(`src="${customUrl}"`);
    expect(customHero).not.toContain("data-character=");
    expect(customIcon).toContain(`src="${customUrl}"`);
    expect(customIcon).not.toContain("data-character=");
  });

  it("removes repeated NoteFable text from AI replies while keeping character, model attribution, and screen-reader label", () => {
    mockSavedIcon.current = "character:piko";

    // Text assistant reply: shows Piko + model name + sr-only "AI reply", no "NoteFable" signature text.
    const textReplyHtml = renderToStaticMarkup(
      createElement(ChatMessage, {
        message: { id: "m1", role: "ASSISTANT", content: "Hello world", model: "gpt-6-luna" },
        isStreaming: false,
        thinkingSeconds: 0,
        characterState: "completed",
      }),
    );
    expect(textReplyHtml).toContain('data-character="piko"');
    expect(textReplyHtml).toContain('data-state="completed"');
    expect(textReplyHtml).toContain("GPT-6 Luna");
    expect(textReplyHtml).toContain('<span class="sr-only">AI reply</span>');
    expect(textReplyHtml).not.toContain(">NoteFable<");

    // Generated image assistant reply: omits chat model label (images come from OpenAI Images API), still has sr-only "AI reply" and no "NoteFable".
    const imageReplyHtml = renderToStaticMarkup(
      createElement(ChatMessage, {
        message: {
          id: "m2",
          role: "ASSISTANT",
          content: "",
          model: "gpt-6-luna",
          generatedImages: [{ id: "img1", dataUrl: "data:image/png;base64,BBBB", mimeType: "image/png" }],
        },
        isStreaming: false,
        thinkingSeconds: 0,
      }),
    );
    expect(imageReplyHtml).toContain('data-character="piko"');
    expect(imageReplyHtml).toContain('<span class="sr-only">AI reply</span>');
    expect(imageReplyHtml).not.toContain("GPT-6 Luna");
    expect(imageReplyHtml).not.toContain(">NoteFable<");
  });

  it("renders reworked Settings -> Icon with Choose a character + Upload an image, removing Choose an emoji and Use NoteFable logo", () => {
    mockSavedIcon.current = "character:foldie";
    for (const locale of ["en", "ja", "zh", "ar"] as const) {
      mockLocale.current = locale;
      const html = renderToStaticMarkup(createElement(AppIconSettings, {}));
      const t = (k: string) => (locale === "en" ? k : messagesFor(locale)[k] ?? k);
      expect(html).toContain(t("Choose a character"));
      expect(html).toContain(t("Upload an image"));
      expect(html).not.toContain(t("Choose an emoji"));
      expect(html).not.toContain(t("Use NoteFable logo"));
    }
  });
});
