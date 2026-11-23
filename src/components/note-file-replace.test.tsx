import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ツールバーの「Replace」は、追加と同じアップロードだけのパネルを開く（外部リンクの「Embed」は出さない）。
const state = vi.hoisted(() => ({
  editable: true,
  selected: [{ id: "img1", type: "image", props: { url: "/api/pages/files?key=a&name=a.png" } }] as { id: string; type: string; props: Record<string, unknown> }[],
  focus: vi.fn(),
}));

vi.mock("@blocknote/ariakit/style.css", () => ({}));
vi.mock("@blocknote/ariakit", () => ({ BlockNoteView: ({ children }: { children: unknown }) => children }));
vi.mock("@blocknote/code-block", () => ({ codeBlockOptions: { supportedLanguages: { text: { name: "Plain Text" } } }, syntaxHighlighter: {} }));
vi.mock("@blocknote/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blocknote/react")>();
  const part = (name: string) => Object.assign(({ children }: { children?: ReactNode }) => children ?? null, { displayName: name });
  return {
    ...actual,
    useBlockNoteEditor: () => ({
      get isEditable() { return state.editable; },
      getSelection: () => ({ blocks: state.selected }),
      getTextCursorPosition: () => ({ block: state.selected[0] }),
      focus: state.focus,
    }),
    useComponentsContext: () => ({
      Generic: { Popover: { Root: part("Popover.Root"), Trigger: part("Popover.Trigger"), Content: part("Popover.Content") } },
      FormattingToolbar: { Button: part("FormattingToolbar.Button") },
    }),
    useEditorState: ({ selector }: { selector: () => unknown }) => selector(),
    usePortalElement: () => undefined,
    useDictionary: () => ({ formatting_toolbar: { file_replace: { tooltip: { image: "Replace image", file: "Replace file" } } } }),
  };
});
vi.mock("@/components/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", dir: "ltr", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/theme", () => ({ useTheme: () => ({ preference: "light", resolved: "light", setPreference: vi.fn() }) }));

import { NoteFileReplaceButton } from "./note-editor";

type Element = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
const childrenOf = (element: Element) => [element.props.children].flat() as Element[];

describe("the toolbar's Replace button for images and files", () => {
  beforeEach(() => {
    state.editable = true;
    state.selected = [{ id: "img1", type: "image", props: { url: "/api/pages/files?key=a&name=a.png" } }];
    state.focus.mockClear();
  });

  it("opens the upload-only panel for the selected block, never the stock panel with Embed", () => {
    const root = NoteFileReplaceButton() as Element;
    const [trigger, content] = childrenOf(root);
    const [button] = childrenOf(trigger);
    expect(button.props.label).toBe("Replace image");
    const [panel] = childrenOf(content);
    expect((panel.type as { name?: string }).name).toBe("NoteFilePanel");
    expect(panel.props.blockId).toBe("img1");

    // パネルの中身はアップロードのタブ 1 つだけ。
    const filePanel = (panel.type as (props: unknown) => Element)(panel.props);
    const tabs = filePanel.props.tabs as { name: string }[];
    expect(tabs.map((tab) => tab.name)).toEqual(["Upload"]);

    // 閉じたらエディターへフォーカスを戻す。
    (root.props.onOpenChange as (open: boolean) => void)(false);
    expect(state.focus).toHaveBeenCalledTimes(1);
  });

  it("labels file blocks and stays hidden when the note can't be edited or the selection isn't one image or file", () => {
    state.selected = [{ id: "f1", type: "file", props: { url: "" } }];
    const [trigger] = childrenOf(NoteFileReplaceButton() as Element);
    expect(childrenOf(trigger)[0].props.label).toBe("Replace file");

    state.editable = false;
    expect(NoteFileReplaceButton()).toBeNull();
    state.editable = true;
    state.selected = [{ id: "p1", type: "paragraph", props: {} }];
    expect(NoteFileReplaceButton()).toBeNull();
    state.selected = [{ id: "img1", type: "image", props: {} }, { id: "img2", type: "image", props: {} }];
    expect(NoteFileReplaceButton()).toBeNull();
  });
});
