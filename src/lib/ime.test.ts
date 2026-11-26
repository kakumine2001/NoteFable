import { describe, expect, it } from "vitest";
import { isImeKeyEvent } from "./ime";

describe("isImeKeyEvent", () => {
  it("treats composing keys and Safari's keyCode 229 as IME keys", () => {
    expect(isImeKeyEvent({ isComposing: true, keyCode: 13 })).toBe(true);
    // Safari: the key that commits a composition has isComposing false but keyCode 229.
    expect(isImeKeyEvent({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  it("lets ordinary Enter and Escape through", () => {
    expect(isImeKeyEvent({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeKeyEvent({ isComposing: false, keyCode: 27 })).toBe(false);
    expect(isImeKeyEvent({})).toBe(false);
  });
});
