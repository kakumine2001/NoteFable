import { describe, expect, it } from "vitest";
import { isElementTarget, isPlayerControlTarget, playerAction, PLAYER_CONTROL_SELECTOR } from "./player-keys";

// 別のウィンドウ（発表者ビュー）の要素も、instanceof ではなく nodeType と closest() で見分ける。
const element = (control: boolean) => ({ nodeType: 1, closest: (selector: string) => (selector === PLAYER_CONTROL_SELECTOR && control ? {} : null) });
const container = (...members: object[]) => ({ contains: (target: unknown) => members.includes(target as object) });
const asTarget = (value: object) => value as unknown as EventTarget;

describe("player keys", () => {
  it("maps keys to player actions", () => {
    const key = (value: string) => ({ key: value, ctrlKey: false, metaKey: false, altKey: false });
    expect(playerAction(key(" "), false)).toEqual({ type: "next" });
    expect(playerAction(key("Enter"), false)).toEqual({ type: "next" });
    expect(playerAction(key("Enter"), true)).toEqual({ type: "jump" });
    expect(playerAction({ ...key("ArrowRight"), ctrlKey: true }, false)).toBeNull();
  });

  it("recognizes elements from another window by node type", () => {
    expect(isElementTarget(element(true))).toBe(true);
    expect(isElementTarget({ nodeType: 3, closest: () => null })).toBe(false);
    expect(isElementTarget({ nodeType: 1 })).toBe(false);
    expect(isElementTarget(null)).toBe(false);
  });

  it("lets Enter and Space reach buttons in the overlay or the presenter window", () => {
    const overlayButton = element(true);
    const presenterButton = element(true);
    const presenterText = element(false);
    const background = element(true);
    const overlay = container(overlayButton);
    const presenter = container(presenterButton, presenterText);
    expect(isPlayerControlTarget(asTarget(overlayButton), [overlay, presenter])).toBe(true);
    expect(isPlayerControlTarget(asTarget(presenterButton), [overlay, presenter])).toBe(true);
    expect(isPlayerControlTarget(asTarget(presenterButton), [overlay, null])).toBe(false);
    expect(isPlayerControlTarget(asTarget(presenterText), [overlay, presenter])).toBe(false);
    // 背後の画面のボタンにフォーカスが残っていても、放映の操作を優先する。
    expect(isPlayerControlTarget(asTarget(background), [overlay, presenter])).toBe(false);
    expect(isPlayerControlTarget(null, [overlay, presenter])).toBe(false);
  });
});
