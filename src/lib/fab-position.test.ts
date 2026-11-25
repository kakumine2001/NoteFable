import { describe, expect, it } from "vitest";
import { anchorAncestors, anchorFabPosition, bubblePlacement, clampFabPosition, FAB_MARGIN, panelPlacement } from "@/lib/fab-position";

describe("clampFabPosition", () => {
  it("keeps a position that is already inside the viewport", () => {
    expect(clampFabPosition({ right: 100, bottom: 200 }, 48, 1000, 800)).toEqual({ right: 100, bottom: 200 });
  });

  it("pulls the button back inside every edge", () => {
    expect(clampFabPosition({ right: -50, bottom: -50 }, 48, 1000, 800)).toEqual({ right: FAB_MARGIN, bottom: FAB_MARGIN });
    expect(clampFabPosition({ right: 5000, bottom: 5000 }, 48, 1000, 800)).toEqual({ right: 1000 - 48 - FAB_MARGIN, bottom: 800 - 48 - FAB_MARGIN });
  });

  it("stays at the margin when the viewport is smaller than the button", () => {
    expect(clampFabPosition({ right: 300, bottom: 300 }, 48, 40, 40)).toEqual({ right: FAB_MARGIN, bottom: FAB_MARGIN });
  });
});

describe("anchorFabPosition", () => {
  it("puts the button on the editor's slot, measured from the right and bottom edges", () => {
    expect(anchorFabPosition({ right: 900, bottom: 700, width: 52, height: 52 }, 1280, 800)).toEqual({ right: 380, bottom: 100 });
  });

  it("gives no position while the slot is not laid out", () => {
    expect(anchorFabPosition({ right: 0, bottom: 0, width: 0, height: 0 }, 1280, 800)).toBeNull();
  });
});

describe("anchorAncestors", () => {
  type Node = { name: string; parentElement: Node | null };
  const html: Node = { name: "html", parentElement: null };
  const body: Node = { name: "body", parentElement: html };
  const stage: Node = { name: "stage", parentElement: { name: "editor", parentElement: { name: "workspace", parentElement: body } } };
  const anchor: Node = { name: "anchor", parentElement: { name: "slot", parentElement: stage } };

  it("lists the anchor and every parent up to, not including, body", () => {
    expect(anchorAncestors(anchor, body).map((node) => node.name)).toEqual(["anchor", "slot", "stage", "editor", "workspace"]);
  });

  it("stops at the top when the anchor is not under body (detached)", () => {
    const detached: Node = { name: "anchor", parentElement: { name: "slot", parentElement: null } };
    expect(anchorAncestors(detached, body).map((node) => node.name)).toEqual(["anchor", "slot"]);
  });
});

describe("panelPlacement", () => {
  it("opens above a button in the lower half", () => {
    const placement = panelPlacement({ right: 20, bottom: 20 }, 48, 416, 1200, 800);
    expect(placement).toMatchObject({ right: 20, bottom: 76, top: "auto" });
    expect(placement.maxHeight).toBe(800 - 20 - 48 - 8 - 20);
  });

  it("opens below a button in the upper half", () => {
    const placement = panelPlacement({ right: 20, bottom: 700 }, 48, 416, 1200, 800);
    expect(placement).toMatchObject({ right: 20, top: 108, bottom: "auto" });
    expect(placement.maxHeight).toBe(700 - 8 - 20);
  });

  it("keeps the panel on screen when the button is at the left edge", () => {
    expect(panelPlacement({ right: 1144, bottom: 20 }, 48, 416, 1200, 800).right).toBe(1200 - 416 - 20);
  });
});

describe("bubblePlacement", () => {
  it("places the bubble to the left of a bottom-right FAB", () => {
    const res = bubblePlacement(null, 52, 1200, 800, "ltr", false);
    expect(res.side).toBe("left");
    expect(res.style.right).toBe(20 + 52 + 12);
    expect(res.style.bottom).toBe(20 + 26);
    expect(res.style.maxWidth).toBe(280);
  });

  it("flips the bubble to the right when the FAB is dragged to the left half or defaults to RTL", () => {
    const draggedLeft = bubblePlacement({ right: 1050, bottom: 120 }, 52, 1200, 800, "ltr", false);
    expect(draggedLeft.side).toBe("right");
    expect(draggedLeft.style.left).toBe(1200 - 1050 + 12);

    const rtlDefault = bubblePlacement(null, 52, 1200, 800, "rtl", false);
    expect(rtlDefault.side).toBe("right");
  });

  it("clamps maxWidth on narrow phone viewports", () => {
    const phone = bubblePlacement(null, 56, 375, 812, "ltr", true);
    expect(phone.side).toBe("left");
    expect(phone.style.maxWidth).toBe(375 - (16 + 56 + 12) - 12 - 16);
  });
});
