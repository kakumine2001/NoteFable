import { describe, expect, it, vi } from "vitest";
import { SessionIconSync } from "./session-icon-sync";

function deferred() {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("SessionIconSync", () => {
  it("keeps an icon that is still being saved when an older list response arrives", async () => {
    const pending = deferred();
    const sync = new SessionIconSync(() => pending.promise);
    const startedAt = sync.mark();
    const saving = sync.change("s1", "📚", null, () => {}, () => {});

    // 保存が終わる前に、古い一覧（icon: null）が届いた。
    expect(sync.reconcile([{ id: "s1", icon: null }, { id: "s2", icon: "🚀" }], startedAt))
      .toEqual([{ id: "s1", icon: "📚" }, { id: "s2", icon: "🚀" }]);

    pending.resolve(true);
    await saving;
    // 保存が終わった後でも、保存より前に取得を始めた一覧では上書きしない。
    expect(sync.reconcile([{ id: "s1", icon: null }], startedAt)).toEqual([{ id: "s1", icon: "📚" }]);
    // 保存の後に取得を始めた一覧は、サーバーの値をそのまま使う。
    expect(sync.reconcile([{ id: "s1", icon: "🌟" }], sync.mark())).toEqual([{ id: "s1", icon: "🌟" }]);
  });

  it("sends one request at a time and only the latest choice", async () => {
    const first = deferred();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
    const sync = new SessionIconSync(send);
    const shown: (string | null)[] = [];
    const show = (icon: string | null) => shown.push(icon);

    const a = sync.change("s1", "🚀", "📚", show, () => {});
    void sync.change("s1", "🎵", "🚀", show, () => {});
    const c = sync.change("s1", "⭐", "🎵", show, () => {});
    expect(send).toHaveBeenCalledTimes(1);

    first.resolve(true);
    await Promise.all([a, c]);
    // 途中の 🎵 は送らず、最後の ⭐ だけを続けて送る。
    expect(send.mock.calls).toEqual([["s1", "🚀"], ["s1", "⭐"]]);
    expect(shown).toEqual(["🚀", "🎵", "⭐"]);
  });

  it("goes back to the last saved icon, not the one before this click, when saving fails", async () => {
    const send = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const sync = new SessionIconSync(send);
    const shown: (string | null)[] = [];
    const fail = vi.fn();

    await sync.change("s1", "🚀", "📚", (icon) => shown.push(icon), fail);
    await sync.change("s1", "⭐", "🚀", (icon) => shown.push(icon), fail);

    expect(shown).toEqual(["🚀", "⭐", "🚀"]);
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it("sends again when the same icon is picked after another device changed it", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const sync = new SessionIconSync(send);
    await sync.change("s1", "📚", null, () => {}, () => {});
    // 別の端末が ⭐ に変え、この端末の一覧にも反映された。
    await sync.change("s1", "📚", "⭐", () => {}, () => {});
    expect(send.mock.calls).toEqual([["s1", "📚"], ["s1", "📚"]]);
  });

  it("does not send when the picked icon is already shown", async () => {
    const send = vi.fn().mockResolvedValue(true);
    await new SessionIconSync(send).change("s1", "📚", "📚", () => {}, () => {});
    expect(send).not.toHaveBeenCalled();
  });
});
