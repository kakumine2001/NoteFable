import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchMenuDismiss } from "./menu-dismiss";

type FakeWindow = EventTarget & { innerWidth: number; innerHeight: number; visualViewport: EventTarget };

describe("watchMenuDismiss", () => {
  let fakeWindow: FakeWindow;
  let clock: number;
  let onClose: ReturnType<typeof vi.fn>;
  let reposition: ReturnType<typeof vi.fn>;
  let insideTarget: EventTarget | null;
  let stop: () => void;

  beforeEach(() => {
    fakeWindow = Object.assign(new EventTarget(), { innerWidth: 412, innerHeight: 600, visualViewport: new EventTarget() });
    vi.stubGlobal("window", fakeWindow);
    clock = 1000;
    onClose = vi.fn();
    reposition = vi.fn();
    insideTarget = null;
    stop = watchMenuDismiss({ isInside: (target) => target !== null && target === insideTarget, onClose, reposition, now: () => clock, settleMs: 500 });
  });

  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
  });

  it("repositions instead of closing when only the height changes (on-screen keyboard hides)", () => {
    fakeWindow.innerHeight = 915;
    fakeWindow.dispatchEvent(new Event("resize"));
    fakeWindow.visualViewport.dispatchEvent(new Event("resize"));
    expect(onClose).not.toHaveBeenCalled();
    expect(reposition).toHaveBeenCalledTimes(2);
  });

  it("closes when the width changes", () => {
    fakeWindow.innerWidth = 915;
    fakeWindow.dispatchEvent(new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores the layout scroll right after opening, but closes on a later outside scroll", () => {
    clock += 100;
    fakeWindow.dispatchEvent(new Event("scroll"));
    expect(onClose).not.toHaveBeenCalled();
    expect(reposition).toHaveBeenCalledTimes(1);

    clock += 1000;
    fakeWindow.dispatchEvent(new Event("scroll"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores the scroll that follows a height-only resize", () => {
    clock += 2000;
    fakeWindow.innerHeight = 915;
    fakeWindow.dispatchEvent(new Event("resize"));
    clock += 50;
    fakeWindow.dispatchEvent(new Event("scroll"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("never closes for scrolling inside the menu", () => {
    clock += 2000;
    insideTarget = fakeWindow;
    fakeWindow.dispatchEvent(new Event("scroll"));
    expect(onClose).not.toHaveBeenCalled();
    expect(reposition).not.toHaveBeenCalled();
  });

  it("stops listening after cleanup", () => {
    stop();
    fakeWindow.innerWidth = 915;
    fakeWindow.dispatchEvent(new Event("resize"));
    fakeWindow.visualViewport.dispatchEvent(new Event("resize"));
    clock += 2000;
    fakeWindow.dispatchEvent(new Event("scroll"));
    expect(onClose).not.toHaveBeenCalled();
    expect(reposition).not.toHaveBeenCalled();
  });
});
