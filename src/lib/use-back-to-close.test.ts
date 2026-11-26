import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useRef: <T,>(value: T) => ({ current: value }),
  useEffect: (effect: () => void) => { effect(); },
}));

import { useBackToClose } from "./use-back-to-close";

function keydown(init: { key: string; isComposing?: boolean; keyCode?: number }) {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperties(event, {
    key: { value: init.key },
    isComposing: { value: init.isComposing ?? false },
    keyCode: { value: init.keyCode ?? 0 },
  });
  return event;
}

describe("useBackToClose Esc handling", () => {
  const onClose = vi.fn();
  let fakeWindow: EventTarget;

  beforeAll(() => {
    const history = { state: null as unknown, pushState(state: unknown) { history.state = state; }, back: vi.fn() };
    fakeWindow = Object.assign(new EventTarget(), { history });
    vi.stubGlobal("window", fakeWindow);
    useBackToClose(true, onClose);
  });

  afterAll(() => { vi.unstubAllGlobals(); });

  it("does not close the sheet for an Esc that cancels an IME composition", () => {
    fakeWindow.dispatchEvent(keydown({ key: "Escape", isComposing: true }));
    // Safari: isComposing is already false, but keyCode is still 229.
    fakeWindow.dispatchEvent(keydown({ key: "Escape", keyCode: 229 }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the top sheet for a plain Esc", () => {
    const event = keydown({ key: "Escape", keyCode: 27 });
    fakeWindow.dispatchEvent(event);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
