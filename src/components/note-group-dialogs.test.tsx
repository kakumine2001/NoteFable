import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backToClose = vi.hoisted(() => ({ calls: [] as { open: boolean; close: () => boolean | void }[] }));
vi.mock("@/lib/use-back-to-close", () => ({
  useBackToClose: (open: boolean, close: () => boolean | void) => { backToClose.calls.push({ open, close }); },
}));

import { Modal } from "./note-group-dialogs";

describe("note dialogs and the Back key", () => {
  beforeEach(() => { backToClose.calls.length = 0; });

  it("registers as a Back/Esc sheet so only the dialog closes, not the drawer under it", () => {
    const onClose = vi.fn();
    renderToStaticMarkup(<Modal label="Move note to Trash?" onClose={onClose}><p>body</p></Modal>);
    expect(backToClose.calls).toHaveLength(1);
    expect(backToClose.calls[0].open).toBe(true);
    expect(backToClose.calls[0].close()).toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refuses to close while a request is in flight", () => {
    const onClose = vi.fn();
    renderToStaticMarkup(<Modal label="Move note to Trash?" busy onClose={onClose}><p>body</p></Modal>);
    expect(backToClose.calls[0].close()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});
