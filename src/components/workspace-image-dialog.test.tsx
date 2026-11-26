import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageImage } from "@/lib/page-images";
import { StorageLimitError } from "@/lib/usage-plans";

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  generatePageImage: vi.fn(),
  savePendingDraft: vi.fn(),
  takePendingDraft: vi.fn(() => ""),
  keepRejectedDraft: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useId: () => "ws-img-id",
  useEffect: vi.fn(),
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => {
    const slot = hooks.index++;
    if (!(slot in hooks.values)) {
      hooks.values[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    }
    return [hooks.values[slot], (next: unknown) => {
      hooks.values[slot] = typeof next === "function" ? (next as (prev: unknown) => unknown)(hooks.values[slot]) : next;
    }];
  },
}));
vi.mock("@/components/i18n-provider", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/account-store", () => ({ useAccount: () => ({ account: { configured: true, billing: false, user: null } }) }));
vi.mock("@/lib/use-back-to-close", () => ({ useBackToClose: vi.fn() }));
vi.mock("@/lib/native-bridge", () => ({ nativeCanShowUsageLimit: () => false, postToNative: vi.fn() }));
vi.mock("@/lib/pending-draft", () => ({
  keepRejectedDraft: hooks.keepRejectedDraft,
  savePendingDraft: hooks.savePendingDraft,
  takePendingDraft: hooks.takePendingDraft,
  useKeepDraftOnLeave: () => ({ current: true }),
}));
vi.mock("@/lib/page-images", async (original) => ({
  ...await original<typeof import("@/lib/page-images")>(),
  generatePageImage: hooks.generatePageImage,
}));

import { WorkspaceImageDialog } from "./workspace-image-dialog";

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

function findNode(node: unknown, predicate: (el: ElementLike) => boolean): ElementLike | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return null;
  }
  const el = node as ElementLike;
  if (predicate(el)) return el;
  return el.props && "children" in el.props ? findNode(el.props.children, predicate) : null;
}

describe("WorkspaceImageDialog", () => {
  beforeEach(() => {
    hooks.values = [];
    hooks.index = 0;
    hooks.generatePageImage.mockReset();
    hooks.savePendingDraft.mockReset();
    hooks.takePendingDraft.mockReturnValue("");
    hooks.keepRejectedDraft.mockReset();
  });

  it("shows preview after generation and inserts only when user confirms", async () => {
    const generated: PageImage = {
      url: "/api/pages/files?key=note-files%2Fu1%2Fpic.png&name=ai-image.png",
      name: "ai-image.png",
      width: 1536,
      height: 1024,
      mimeType: "image/png",
      prompt: "A sunny garden",
    };
    hooks.generatePageImage.mockResolvedValueOnce(generated);
    const onInsert = vi.fn();
    const onClose = vi.fn();

    const render = (mode: "insert" | "replace" = "insert") => {
      hooks.index = 0;
      return WorkspaceImageDialog({
        pageId: "p1",
        pageKind: "note",
        mode,
        onInsert,
        onClose,
      });
    };

    const initialTree = render();
    const textarea = findNode(initialTree, (el) => el.type === "textarea");
    (textarea?.props?.onChange as (e: { target: { value: string } }) => void)({ target: { value: "A sunny garden" } });

    const withPrompt = render();
    const form = findNode(withPrompt, (el) => el.type === "form");
    await (form?.props?.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });

    expect(hooks.generatePageImage).toHaveBeenCalledWith("A sunny garden", "1536x1024");
    expect(onInsert).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    const previewTree = render();
    const img = findNode(previewTree, (el) => el.type === "img");
    expect(img?.props?.src).toBe(generated.url);
    expect(findNode(previewTree, (el) => el.type === "button" && collectText(el.props?.children).includes("Generate again"))).not.toBeNull();
    const insertButton = findNode(previewTree, (el) => el.type === "button" && collectText(el.props?.children).includes("Insert"));
    expect(insertButton).not.toBeNull();

    (insertButton?.props?.onClick as () => void)();
    expect(onInsert).toHaveBeenCalledWith(generated);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the prompt and displays an error when generation fails", async () => {
    hooks.generatePageImage.mockRejectedValueOnce(new Error("Could not create the image. Try again."));
    const render = () => {
      hooks.index = 0;
      return WorkspaceImageDialog({
        pageId: "p2",
        pageKind: "whiteboard",
        onInsert: vi.fn(),
        onClose: vi.fn(),
      });
    };

    const initialTree = render();
    const textarea = findNode(initialTree, (el) => el.type === "textarea");
    (textarea?.props?.onChange as (e: { target: { value: string } }) => void)({ target: { value: "Architecture diagram" } });

    const withPrompt = render();
    const form = findNode(withPrompt, (el) => el.type === "form");
    await (form?.props?.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });

    const errorTree = render();
    const afterTextarea = findNode(errorTree, (el) => el.type === "textarea");
    expect(afterTextarea?.props?.value).toBe("Architecture diagram");
    const alert = findNode(errorTree, (el) => el.props?.role === "alert");
    expect(collectText(alert)).toContain("Could not create the image. Try again.");
  });

  it("keeps the existing preview and rejected prompt when regenerating hits the storage limit, and allows reporting the preview", async () => {
    const generated: PageImage = {
      url: "/api/pages/files?key=note-files%2Fu1%2Fpic2.png&name=ai-image.png",
      name: "ai-image.png",
      width: 1024,
      height: 1024,
      mimeType: "image/png",
      prompt: "Mountain lake",
      reportToken: "signed-report-token",
    };
    hooks.generatePageImage
      .mockResolvedValueOnce(generated)
      .mockRejectedValueOnce(new StorageLimitError("Storage is full.", "member", 500, 500));

    const onInsert = vi.fn();
    const onClose = vi.fn();
    const render = () => {
      hooks.index = 0;
      return WorkspaceImageDialog({
        pageId: "wb1",
        pageKind: "whiteboard",
        onInsert,
        onClose,
      });
    };

    const initialTree = render();
    const textarea = findNode(initialTree, (el) => el.type === "textarea");
    (textarea?.props?.onChange as (e: { target: { value: string } }) => void)({ target: { value: "Mountain lake" } });

    const withPrompt = render();
    const form = findNode(withPrompt, (el) => el.type === "form");
    await (form?.props?.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });

    const previewTree = render();
    expect(findNode(previewTree, (el) => el.type === "button" && collectText(el.props?.children).includes("Report image"))).not.toBeNull();

    // User edits prompt and regenerates -> hits storage limit -> dialog stays open with previous preview still insertable.
    const editTextarea = findNode(previewTree, (el) => el.type === "textarea");
    (editTextarea?.props?.onChange as (e: { target: { value: string } }) => void)({ target: { value: "New rejected prompt" } });
    const editedTree = render();
    const retryForm = findNode(editedTree, (el) => el.type === "form");
    await (retryForm?.props?.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });

    expect(onClose).not.toHaveBeenCalled();
    const afterRetry = render();
    expect(findNode(afterRetry, (el) => el.type === "img")?.props?.src).toBe(generated.url);
    expect(collectText(findNode(afterRetry, (el) => el.props?.role === "alert"))).toContain("Storage is full.");

    // Inserting the older preview must NOT clear the rejected regeneration prompt draft.
    hooks.savePendingDraft.mockClear();
    const insertButton = findNode(afterRetry, (el) => el.type === "button" && collectText(el.props?.children).includes("Insert"));
    (insertButton?.props?.onClick as () => void)();
    expect(onInsert).toHaveBeenCalledWith(generated);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hooks.savePendingDraft).not.toHaveBeenCalledWith(expect.any(String), "", expect.anything());
  });

  it("supports sketch-to-image mode with optional description and sketch preview", async () => {
    const sketchBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    const generated: PageImage = {
      url: "/api/pages/files?key=note-files%2Fu1%2Fsketch-gen.png&name=ai-image.png",
      name: "ai-image.png",
      width: 1536,
      height: 1024,
      mimeType: "image/png",
      prompt: "Turn this whiteboard sketch into a clean illustration.",
      reportToken: "tok-sketch",
    };
    hooks.generatePageImage.mockResolvedValueOnce(generated);
    const onInsert = vi.fn();
    const onClose = vi.fn();

    const render = () => {
      hooks.index = 0;
      return WorkspaceImageDialog({
        pageId: "wb2",
        pageKind: "whiteboard",
        defaultSize: "1024x1024",
        referenceImage: { blob: sketchBlob, previewUrl: "blob:sketch-preview" },
        onInsert,
        onClose,
      });
    };

    const initialTree = render();
    expect(collectText(initialTree)).toContain("Turn sketch into image");
    const sketchImg = findNode(initialTree, (el) => el.type === "img" && el.props?.src === "blob:sketch-preview");
    expect(sketchImg).not.toBeNull();
    const generateBtn = findNode(initialTree, (el) => el.type === "button" && collectText(el.props?.children).includes("Generate"));
    expect(generateBtn?.props?.disabled).toBe(false);

    const form = findNode(initialTree, (el) => el.type === "form");
    await (form?.props?.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });

    expect(hooks.generatePageImage).toHaveBeenCalledWith("", "1024x1024", { referenceImage: sketchBlob });
    const previewTree = render();
    const insertButton = findNode(previewTree, (el) => el.type === "button" && collectText(el.props?.children).includes("Insert"));
    (insertButton?.props?.onClick as () => void)();
    expect(onInsert).toHaveBeenCalledWith(generated);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
