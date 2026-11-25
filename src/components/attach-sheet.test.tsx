import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ open: true, setOpen: vi.fn() }));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  useRef: vi.fn(() => ({ current: null })),
  useState: () => [state.open, state.setOpen],
}));
vi.mock("react-dom", () => ({
  createPortal: (node: unknown) => node,
}));
vi.mock("@/components/i18n-provider", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/use-back-to-close", () => ({ useBackToClose: vi.fn() }));
vi.mock("@/lib/use-swipe-dismiss", () => ({
  useSwipeDismiss: () => ({ attach: vi.fn(), bind: {} }),
}));

import { AttachMenu, AttachSheet } from "./attach-sheet";

type ElementLike = { type?: unknown; props?: Record<string, unknown> };

function collectText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as ElementLike).props;
    return props && "children" in props ? collectText(props.children) : "";
  }
  return "";
}

function findButton(node: unknown, label: string): ElementLike | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found) return found;
    }
    return null;
  }
  const el = node as ElementLike;
  if (el.type === "button" && collectText(el.props?.children).includes(label)) return el;
  return el.props && "children" in el.props ? findButton(el.props.children, label) : null;
}

describe("AttachMenu and AttachSheet Create page item", () => {
  beforeEach(() => {
    state.open = true;
    state.setOpen.mockReset();
    vi.stubGlobal("document", { body: {} });
  });

  it("omits Create page from AttachMenu when onCreatePage is not provided", () => {
    const tree = AttachMenu({ disabled: false, onFilesChange: vi.fn(), onToggleImageMode: vi.fn() });
    expect(findButton(tree, "Create page")).toBeNull();
    expect(findButton(tree, "Generate an image")).toBeNull();
  });

  it("renders Generate an image in AttachMenu when onGenerateImage is provided", () => {
    const onGenerateImage = vi.fn();
    const tree = AttachMenu({ disabled: false, onFilesChange: vi.fn(), onGenerateImage });
    const button = findButton(tree, "Generate an image");
    expect(button?.props?.["aria-haspopup"]).toBe("dialog");
    (button?.props?.onClick as () => void)();
    expect(state.setOpen).toHaveBeenCalledWith(false);
    expect(onGenerateImage).toHaveBeenCalledTimes(1);
  });

  it("renders Create page in AttachMenu when onCreatePage is provided and respects createPageDisabled", () => {
    const onCreatePage = vi.fn();
    const disabledTree = AttachMenu({
      disabled: false,
      onFilesChange: vi.fn(),
      onCreatePage,
      createPageDisabled: true,
    });
    const disabledButton = findButton(disabledTree, "Create page");
    expect(disabledButton?.props?.disabled).toBe(true);
    expect(disabledButton?.props?.["aria-haspopup"]).toBe("dialog");

    const enabledTree = AttachMenu({
      disabled: false,
      onFilesChange: vi.fn(),
      onCreatePage,
      createPageDisabled: false,
    });
    const enabledButton = findButton(enabledTree, "Create page");
    expect(enabledButton?.props?.disabled).toBe(false);
    (enabledButton?.props?.onClick as () => void)();
    expect(state.setOpen).toHaveBeenCalledWith(false);
    expect(onCreatePage).toHaveBeenCalledTimes(1);
  });

  it("omits Create page from AttachSheet when onCreatePage is not provided", () => {
    const tree = AttachSheet({
      open: true,
      onClose: vi.fn(),
      onFilesChange: vi.fn(),
      imageMode: false,
      onToggleImageMode: vi.fn(),
      onAttachPages: vi.fn(),
    });
    expect(findButton(tree, "Create page")).toBeNull();
  });

  it("renders Create page in AttachSheet when onCreatePage is provided and closes before opening dialog", () => {
    const onClose = vi.fn();
    const onCreatePage = vi.fn();
    const tree = AttachSheet({
      open: true,
      onClose,
      onFilesChange: vi.fn(),
      imageMode: false,
      onToggleImageMode: vi.fn(),
      onAttachPages: vi.fn(),
      onCreatePage,
      createPageDisabled: false,
    });
    const button = findButton(tree, "Create page");
    expect(button?.props?.disabled).toBe(false);
    expect(button?.props?.["aria-haspopup"]).toBe("dialog");
    (button?.props?.onClick as () => void)();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreatePage).toHaveBeenCalledTimes(1);
  });
});
