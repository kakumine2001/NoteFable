import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHARACTER_IDS } from "@/lib/characters";
import { messagesFor } from "@/lib/i18n/messages";

const hookSlots = vi.hoisted(() => ({
  active: false,
  values: [] as unknown[],
  cursor: 0,
}));

vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  let idSeq = 0;
  return {
    ...actual,
    useId: () => (hookSlots.active ? `test-id-${++idSeq}` : actual.useId()),
    useRef: (initial: unknown) => (hookSlots.active ? { current: initial } : actual.useRef(initial)),
    useEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) => {
      if (!hookSlots.active) actual.useEffect(fn, deps);
    },
    useCallback: <T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]) => (
      hookSlots.active ? fn : actual.useCallback(fn, deps)
    ),
    useState: (initial: unknown) => {
      if (!hookSlots.active) return actual.useState(initial);
      const idx = hookSlots.cursor++;
      if (idx >= hookSlots.values.length) {
        hookSlots.values.push(typeof initial === "function" ? (initial as () => unknown)() : initial);
      }
      const set = (next: unknown) => {
        hookSlots.values[idx] = typeof next === "function"
          ? (next as (prev: unknown) => unknown)(hookSlots.values[idx])
          : next;
      };
      return [hookSlots.values[idx], set];
    },
  };
});

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
import { deriveNoteAssistantCharacterStates } from "./note-assistant";

describe("product-wide character touchpoints & AI reply de-branding", () => {
  beforeEach(() => {
    mockLocale.current = "en";
    mockSavedIcon.current = null;
    hookSlots.active = false;
    hookSlots.values = [];
    hookSlots.cursor = 0;
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
    // Chat replies show the character at 32px (native AssistantTurn uses 32.dp); the note panel passes a smaller size.
    expect(textReplyHtml).toMatch(/<svg[^>]*data-character="piko"[^>]*width="32"|<svg[^>]*width="32"[^>]*data-character="piko"/);
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

    // Failed image assistant reply (isImageTurn preserved after isGeneratingImage clears with no generatedImages):
    // still omits the text-chat model label so failed image turns never claim GPT-6 Luna wrote them.
    const failedImageReplyHtml = renderToStaticMarkup(
      createElement(ChatMessage, {
        message: {
          id: "m3",
          role: "ASSISTANT",
          content: "Request failed: Failed to generate image.",
          model: "gpt-6-luna",
          failed: true,
          isGeneratingImage: false,
          isImageTurn: true,
        },
        isStreaming: false,
        thinkingSeconds: 0,
        characterState: "error",
      }),
    );
    expect(failedImageReplyHtml).toContain('data-character="piko"');
    expect(failedImageReplyHtml).toContain('data-state="error"');
    expect(failedImageReplyHtml).toContain('<span class="sr-only">AI reply</span>');
    expect(failedImageReplyHtml).not.toContain("GPT-6 Luna");
    expect(failedImageReplyHtml).not.toContain(">NoteFable<");
  });

  it("falls back to Quill when a custom image data URL fails to decode, and retries when the saved image changes", () => {
    type AnyEl = ReactElement<Record<string, unknown>>;
    const renderWithHooks = (factory: () => ReactNode): AnyEl => {
      hookSlots.active = true;
      hookSlots.cursor = 0;
      const expand = (node: ReactNode): ReactNode => {
        if (!node || typeof node !== "object" || Array.isArray(node)) return node;
        const el = node as AnyEl;
        if (typeof el.type === "function") {
          return expand((el.type as (props: unknown) => ReactNode)(el.props));
        }
        const children = el.props?.children as ReactNode;
        if (Array.isArray(children)) {
          return { ...el, props: { ...el.props, children: children.map(expand) } };
        }
        if (children) {
          return { ...el, props: { ...el.props, children: expand(children) } };
        }
        return el;
      };
      try {
        return expand(factory()) as AnyEl;
      } finally {
        hookSlots.active = false;
      }
    };

    const findImg = (node: ReactNode): AnyEl | null => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) {
        for (const item of node) {
          const found = findImg(item);
          if (found) return found;
        }
        return null;
      }
      const el = node as AnyEl;
      if (el.type === "img") return el;
      return findImg(el.props?.children as ReactNode);
    };

    const findSvg = (node: ReactNode): AnyEl | null => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) {
        for (const item of node) {
          const found = findSvg(item);
          if (found) return found;
        }
        return null;
      }
      const el = node as AnyEl;
      if (el.type === "svg" && el.props["data-character"]) return el;
      return findSvg(el.props?.children as ReactNode);
    };

    // Empty-payload data URLs immediately render Quill across all touchpoints.
    mockSavedIcon.current = "data:image/png;base64,";
    expect(renderToStaticMarkup(createElement(Mascot, { state: "idle" }))).toContain('data-character="quill"');
    expect(renderToStaticMarkup(createElement(AppIcon, { size: 24 }))).toContain('data-character="quill"');
    expect(renderToStaticMarkup(createElement(NoteFableLogo))).toContain('data-character="quill"');
    expect(renderToStaticMarkup(createElement(AppIconSettings, {}))).toContain('data-character="quill"');

    // Truncated/corrupt PNG data URL takes image branch initially, falls back to Quill on decode error
    // (both async onError and synchronous broken-image ref check), and retries when the saved image value changes.
    for (const { renderSlot, expectedState } of [
      { renderSlot: () => createElement(AppIcon, { size: 24, state: "thinking", animated: true }), expectedState: "thinking" },
      { renderSlot: () => createElement(Mascot, { state: "thinking" }), expectedState: "thinking" },
      { renderSlot: () => createElement(NoteFableLogo), expectedState: "idle" },
      { renderSlot: () => createElement(AppIconSettings, {}), expectedState: "idle" },
    ]) {
      hookSlots.values = [];
      mockSavedIcon.current = "data:image/png;base64,TRUNCATED_PNG";

      const initialTree = renderWithHooks(renderSlot);
      const brokenImg = findImg(initialTree);
      expect(brokenImg).not.toBeNull();
      expect(brokenImg!.props.src).toBe("data:image/png;base64,TRUNCATED_PNG");

      // Simulate browser image decode failure -> re-render falls back to Quill in the current state.
      (brokenImg!.props.onError as () => void)();
      const fallbackTree = renderWithHooks(renderSlot);
      expect(findImg(fallbackTree)).toBeNull();
      const fallbackSvg = findSvg(fallbackTree);
      expect(fallbackSvg).not.toBeNull();
      expect(fallbackSvg!.props["data-character"]).toBe("quill");
      expect(fallbackSvg!.props["data-state"]).toBe(expectedState);

      // Updating the saved custom image retries the new image URL instead of staying stuck on fallback.
      mockSavedIcon.current = "data:image/png;base64,NEW_VALID_PNG";
      const retriedTree = renderWithHooks(renderSlot);
      const retriedImg = findImg(retriedTree);
      expect(retriedImg).not.toBeNull();
      expect(retriedImg!.props.src).toBe("data:image/png;base64,NEW_VALID_PNG");

      // Also verify immediate ref-based broken image detection (when cached broken data URL already completed before mount).
      (retriedImg!.props.ref as (img: Partial<HTMLImageElement>) => void)({ complete: true, naturalWidth: 0 });
      const syncFallbackTree = renderWithHooks(renderSlot);
      expect(findImg(syncFallbackTree)).toBeNull();
      expect(findSvg(syncFallbackTree)?.props["data-character"]).toBe("quill");
    }
  });

  it("scopes NoteAssistant turn output to the active send so follow-up saves/uploads stay in thinking instead of flashing responding", () => {
    const previousTurnMessages = [
      { id: "u1", role: "USER" as const, content: "Summarize this note" },
      { id: "a1", role: "ASSISTANT" as const, content: "First completed answer.", model: "gpt-6-luna" },
    ];

    // Follow-up started: activeTurnAssistantId is already set to new "a2", while note flush / attachment upload is still pending
    // (so "a2" is not in messages yet, and "a1" still holds the previous answer).
    const pendingSaveOrUpload = deriveNoteAssistantCharacterStates({
      messages: previousTurnMessages,
      activeTurnAssistantId: "a2",
      busy: true,
      streaming: false,
      outcome: null,
      isTyping: false,
      hidden: false,
    });
    expect(pendingSaveOrUpload.hasTurnOutput).toBe(false);
    expect(pendingSaveOrUpload.noteCharacterState).toBe("thinking");
    expect(pendingSaveOrUpload.replyCharacterState).toBe("idle");

    // Placeholder "a2" appended and stream opened before first token -> still thinking.
    const waitingFirstToken = deriveNoteAssistantCharacterStates({
      messages: [
        ...previousTurnMessages,
        { id: "u2", role: "USER", content: "Now add bullet points" },
        { id: "a2", role: "ASSISTANT", content: "", model: "gpt-6-luna" },
      ],
      activeTurnAssistantId: "a2",
      busy: true,
      streaming: true,
      outcome: null,
      isTyping: false,
      hidden: false,
    });
    expect(waitingFirstToken.hasTurnOutput).toBe(false);
    expect(waitingFirstToken.noteCharacterState).toBe("thinking");
    expect(waitingFirstToken.replyCharacterState).toBe("thinking");

    // First delta arrives on "a2" -> transitions to responding.
    const streamingDelta = deriveNoteAssistantCharacterStates({
      messages: [
        ...previousTurnMessages,
        { id: "u2", role: "USER", content: "Now add bullet points" },
        { id: "a2", role: "ASSISTANT", content: "• Point 1", model: "gpt-6-luna" },
      ],
      activeTurnAssistantId: "a2",
      busy: true,
      streaming: true,
      outcome: null,
      isTyping: false,
      hidden: false,
    });
    expect(streamingDelta.hasTurnOutput).toBe(true);
    expect(streamingDelta.noteCharacterState).toBe("responding");
    expect(streamingDelta.replyCharacterState).toBe("responding");

    // Stream fails after partial output -> outcome="error" drives error state, never completed.
    const failedMidStream = deriveNoteAssistantCharacterStates({
      messages: [
        ...previousTurnMessages,
        { id: "u2", role: "USER", content: "Now add bullet points" },
        { id: "a2", role: "ASSISTANT", content: "• Point 1\n\nRequest failed: Upstream reset.", model: "gpt-6-luna" },
      ],
      activeTurnAssistantId: "a2",
      busy: false,
      streaming: false,
      outcome: "error",
      isTyping: false,
      hidden: false,
    });
    expect(failedMidStream.noteCharacterState).toBe("error");
    expect(failedMidStream.replyCharacterState).toBe("error");
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
