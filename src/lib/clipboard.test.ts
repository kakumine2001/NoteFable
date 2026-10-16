import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "./clipboard";

class FakeElement {
  isConnected = true;
  focus = vi.fn();
}

// Node にはブラウザの DOM が無いので、必要な部分だけを差し替える。
function stubDom({ copy, writeText }: { copy?: () => boolean; writeText?: (text: string) => Promise<void> }) {
  const opener = new FakeElement();
  const textarea = { value: "", readOnly: false, style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn() };
  const body = { appendChild: vi.fn(), removeChild: vi.fn() };
  const document = {
    activeElement: opener,
    body,
    createElement: vi.fn(() => textarea),
    execCommand: vi.fn(copy ?? (() => true)),
  };
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", writeText ? { clipboard: { writeText } } : {});
  return { opener, textarea, body, document };
}

afterEach(() => vi.unstubAllGlobals());

describe("writeClipboardText", () => {
  it("uses the async clipboard when it is available", async () => {
    const writeText = vi.fn(async () => {});
    const { document } = stubDom({ writeText });
    await expect(writeClipboardText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it("falls back to a hidden textarea when the async clipboard is refused, and restores the focus", async () => {
    const { opener, textarea, body, document } = stubDom({ writeText: async () => { throw new Error("denied"); } });
    await expect(writeClipboardText("回答 text")).resolves.toBe(true);
    expect(textarea.value).toBe("回答 text");
    expect(textarea.select).toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(body.appendChild).toHaveBeenCalledWith(textarea);
    expect(body.removeChild).toHaveBeenCalledWith(textarea);
    expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("falls back when there is no async clipboard (insecure context)", async () => {
    const { document } = stubDom({});
    await expect(writeClipboardText("x")).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when copying is not possible, and still cleans up", async () => {
    const refused = stubDom({ copy: () => false });
    await expect(writeClipboardText("x")).resolves.toBe(false);
    expect(refused.body.removeChild).toHaveBeenCalled();

    const thrown = stubDom({ copy: () => { throw new Error("blocked"); } });
    await expect(writeClipboardText("x")).resolves.toBe(false);
    expect(thrown.body.removeChild).toHaveBeenCalled();
  });
});
