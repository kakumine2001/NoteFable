import { afterEach, describe, expect, it, vi } from "vitest";
import { connectWhiteboardActions } from "@/lib/whiteboard/excalidraw-bridge";

class FakeHistory {
  undoResult: unknown = ["elements", "state"];
  redoResult: unknown = ["elements", "state"];
  undo() { return this.undoResult; }
  redo() { return this.redoResult; }
}

describe("connectWhiteboardActions history replay hook", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("notifies only when undo or redo restores a snapshot, and restores methods on unsubscribe", () => {
    vi.stubGlobal("KeyboardEvent", class {
      key: string;
      constructor(_type: string, init?: { key?: string }) { this.key = init?.key ?? ""; }
    });
    const history = new FakeHistory();
    const editor = { actionManager: { actions: {}, executeAction: vi.fn() }, history };
    let registeredKeyTest: ((event: KeyboardEvent, appState: unknown, elements: unknown, editor: unknown) => boolean) | null = null;
    const container = {
      dispatchEvent: (event: KeyboardEvent) => {
        registeredKeyTest?.(event, {}, [], editor);
        return true;
      },
    } as unknown as HTMLElement;
    const actions = connectWhiteboardActions({
      registerAction: (action: { keyTest: NonNullable<typeof registeredKeyTest> }) => { registeredKeyTest = action.keyTest; },
    }, container);

    const listener = vi.fn();
    const off = actions.onHistoryReplay(listener);

    history.undo();
    history.redo();
    expect(listener).toHaveBeenCalledTimes(2);

    // 空の履歴（undefined を返す）では通知しない。
    history.undoResult = undefined;
    history.redoResult = undefined;
    history.undo();
    history.redo();
    expect(listener).toHaveBeenCalledTimes(2);

    // 購読解除で元のプロトタイプ実装に戻す。
    off();
    expect(Object.prototype.hasOwnProperty.call(history, "undo")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(history, "redo")).toBe(false);
    history.undoResult = ["elements", "state"];
    history.undo();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
