import { afterEach, describe, expect, it, vi } from "vitest";

const portalSpy = vi.hoisted(() => vi.fn((node: unknown, container: unknown) => ({ $$portal: true, node, container })));

vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useRef: (initial: unknown) => ({ current: initial }),
    useLayoutEffect: vi.fn(),
  };
});
vi.mock("react-dom", async (original) => {
  const actual = await original<typeof import("react-dom")>();
  return {
    ...actual,
    createPortal: portalSpy,
  };
});
vi.mock("@/components/i18n-provider", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/use-back-to-close", () => ({
  useBackToClose: vi.fn(),
}));

import { AnswerMenu } from "./answer-actions";

describe("AnswerMenu portal", () => {
  afterEach(() => {
    portalSpy.mockClear();
    vi.unstubAllGlobals();
  });

  it("portals the modal menu dialog into document.body so hover-only ancestors cannot disable pointer events", () => {
    const fakeBody = { tagName: "BODY" };
    vi.stubGlobal("document", { body: fakeBody });

    const rendered = AnswerMenu({
      id: "menu-1",
      anchor: { left: 0, right: 20, top: 0, bottom: 20 } as DOMRect,
      trigger: {} as HTMLButtonElement,
      focusLast: false,
      onClose: vi.fn(),
      className: "new-page-menu",
      children: "items",
    }) as unknown as { $$portal: boolean; container: unknown; node: { type: string; props: { className: string } } };

    expect(portalSpy).toHaveBeenCalledTimes(1);
    expect(rendered.$$portal).toBe(true);
    expect(rendered.container).toBe(fakeBody);
    expect(rendered.node.type).toBe("dialog");
    expect(rendered.node.props.className).toContain("new-page-menu");
  });
});
