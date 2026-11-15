import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSaveError, getAccountSnapshot, loadAccount, resetAccountStore, saveProfile, settled, uploadPhoto } from "./account-store";
import { applyProfileEdit, profileEditChanges, type AccountUser } from "./user-profile";

const base: AccountUser = {
  name: "Mine Kaku", googleName: "Mine Kaku", email: "a@example.com", image: "https://example.com/p.png",
  displayName: null, icon: null, avatarUrl: null, locale: null,
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// 返事を保留できる偽の fetch。送られた順にサーバーが処理した状態を再現する。
function fakeServer() {
  let server = { ...base };
  const calls: { method: string; body: unknown }[] = [];
  const gates: (() => void)[] = [];
  let failNext = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/account" && method === "GET") return Response.json({ configured: true, user: server });
    if (url === "/api/account" && method === "PATCH") {
      const patch = JSON.parse(String(init?.body));
      calls.push({ method, body: patch });
      await new Promise<void>((resolve) => gates.push(resolve));
      if (failNext > 0) { failNext -= 1; return Response.json({ error: "Could not save." }, { status: 500 }); }
      server = applyProfileEdit(server, patch);
      return Response.json({ user: server });
    }
    if (url === "/api/account/avatar" && method === "POST") {
      calls.push({ method, body: "photo" });
      await new Promise<void>((resolve) => gates.push(resolve));
      server = { ...server, avatarUrl: "/api/account/avatar?v=new", icon: null };
      return Response.json({ user: server }, { status: 201 });
    }
    return new Response("{}", { status: 404 });
  });
  const release = async () => { await tick(); gates.shift()?.(); await tick(); };
  return { fetchMock, calls, release, failNext: (n = 1) => { failNext = n; } };
}

async function ready(fake: ReturnType<typeof fakeServer>) {
  vi.stubGlobal("fetch", fake.fetchMock);
  loadAccount();
  await tick();
}

describe("profile edits (pure rules)", () => {
  it("drops the uploaded photo when an icon is chosen or the Google look is restored", () => {
    const withPhoto = { ...base, avatarUrl: "/api/account/avatar?v=x" };
    expect(applyProfileEdit(withPhoto, { icon: "🦊" })).toMatchObject({ icon: "🦊", avatarUrl: null });
    expect(applyProfileEdit(withPhoto, { icon: null })).toMatchObject({ icon: null, avatarUrl: null });
    expect(applyProfileEdit(withPhoto, { displayName: "Kaku" })).toMatchObject({ name: "Kaku", avatarUrl: "/api/account/avatar?v=x" });
    // 表示言語を変えても、名前・写真はそのまま。
    expect(applyProfileEdit(withPhoto, { locale: "ja" })).toMatchObject({ locale: "ja", avatarUrl: "/api/account/avatar?v=x" });
    expect(profileEditChanges(base, { locale: "ja" })).toBe(true);
    expect(profileEditChanges({ ...base, locale: "ja" }, { locale: "ja" })).toBe(false);
  });

  it("does not resend an edit that changes nothing", () => {
    expect(profileEditChanges(base, { displayName: null })).toBe(false);
    expect(profileEditChanges({ ...base, displayName: "Kaku", name: "Kaku" }, { displayName: "Kaku" })).toBe(false);
    expect(profileEditChanges(base, { displayName: "Kaku" })).toBe(true);
    // 写真があるときに「アイコンなし」を選ぶのは、写真を外す変更
    expect(profileEditChanges({ ...base, avatarUrl: "/x" }, { icon: null })).toBe(true);
  });
});

describe("account store", () => {
  beforeEach(() => {
    resetAccountStore();
    vi.unstubAllGlobals();
  });

  it("sends edits one at a time, in the order they were made", async () => {
    const fake = fakeServer();
    await ready(fake);

    const first = saveProfile({ displayName: "Foo" });
    const second = saveProfile({ icon: "🦊" });
    await tick();
    // 先の保存が終わるまで、次は送らない
    expect(fake.calls).toEqual([{ method: "PATCH", body: { displayName: "Foo" } }]);
    await fake.release();
    await first;
    expect(fake.calls.map((call) => call.body)).toEqual([{ displayName: "Foo" }, { icon: "🦊" }]);
    await fake.release();
    await second;
    await settled();
  });

  it("ignores a second identical save (Enter followed by blur)", async () => {
    const fake = fakeServer();
    await ready(fake);
    const a = saveProfile({ displayName: "Foo" });
    const b = saveProfile({ displayName: "Foo" });
    await fake.release();
    await Promise.all([a, b]);
    expect(fake.calls).toHaveLength(1);
  });

  it("keeps a later edit when an earlier save fails", async () => {
    const fake = fakeServer();
    await ready(fake);
    fake.failNext(1);
    const first = saveProfile({ displayName: "Bad" });
    const second = saveProfile({ icon: "🦊" });
    await fake.release();
    await first;
    await fake.release();
    await second;
    const reloaded = await (await fake.fetchMock("/api/account")).json();
    // サーバーには 2 つ目の編集だけが入っている（1 つ目は失敗）
    expect(reloaded.user).toMatchObject({ displayName: null, icon: "🦊" });
  });

  it("puts a photo upload in the same order as the edits around it", async () => {
    const fake = fakeServer();
    await ready(fake);
    const save = saveProfile({ displayName: "Foo" });
    const upload = uploadPhoto(new Blob(["x"]));
    await tick();
    expect(fake.calls).toHaveLength(1);
    await fake.release();
    await save;
    await fake.release();
    await expect(upload).resolves.toBe("");
    expect(fake.calls.map((call) => call.body)).toEqual([{ displayName: "Foo" }, "photo"]);
  });

  it("settled() waits for every save that is still in flight", async () => {
    const fake = fakeServer();
    await ready(fake);
    saveProfile({ displayName: "Foo" });
    let done = false;
    void settled().then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(done).toBe(false);
    await fake.release();
    await settled();
    expect(done).toBe(true);
  });

  it("keeps showing a later optimistic edit while an earlier one is still being saved, even after the earlier one fails", async () => {
    const fake = fakeServer();
    await ready(fake);
    fake.failNext(1);
    const first = saveProfile({ displayName: "Bad" });
    const second = saveProfile({ icon: "🦊" });
    // 2 つとも送信待ち: 画面は両方の編集を反映している
    expect(getAccountSnapshot().account?.user).toMatchObject({ name: "Bad", icon: "🦊" });
    await fake.release();
    await first;
    // 1 つ目は失敗して外れ、2 つ目はまだ反映されたまま（巻き戻らない）。エラーも出ている
    expect(getAccountSnapshot().account?.user).toMatchObject({ name: "Mine Kaku", icon: "🦊" });
    expect(getAccountSnapshot().saveError).toBe("Could not save.");
    await fake.release();
    await second;
    // 後の編集が保存できたら、先のエラー表示は消える
    expect(getAccountSnapshot().saveError).toBe("");
    expect(getAccountSnapshot().account?.user).toMatchObject({ name: "Mine Kaku", icon: "🦊" });
  });

  it("an upload response keeps the edits that are still waiting", async () => {
    const fake = fakeServer();
    await ready(fake);
    const upload = uploadPhoto(new Blob(["x"]));
    const save = saveProfile({ displayName: "After upload" });
    await fake.release();
    await upload;
    expect(getAccountSnapshot().account?.user).toMatchObject({ avatarUrl: "/api/account/avatar?v=new", name: "After upload" });
    await fake.release();
    await save;
    expect(getAccountSnapshot().account?.user).toMatchObject({ avatarUrl: "/api/account/avatar?v=new", displayName: "After upload" });
  });

  it("retries loading the account after a failed first request", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++calls === 1 ? new Response("{}", { status: 500 }) : Response.json({ configured: true, user: base }))));
    loadAccount();
    await vi.advanceTimersByTimeAsync(0);
    expect(getAccountSnapshot().account).toBeNull();
    await vi.advanceTimersByTimeAsync(2100);
    expect(getAccountSnapshot().account?.user?.name).toBe("Mine Kaku");
    vi.useRealTimers();
  });

  it("clearSaveError is safe to call when nothing failed", () => {
    expect(() => clearSaveError()).not.toThrow();
  });
});
