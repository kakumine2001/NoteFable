import { beforeEach, describe, expect, it, vi } from "vitest";

const local = vi.hoisted(() => ({ value: null as string | null, save: vi.fn() }));
vi.mock("@/lib/app-icon", async (original) => ({
  ...(await original<typeof import("@/lib/app-icon")>()),
  readAppIcon: () => local.value,
  saveAppIcon: (icon: string | null) => { local.save(icon); local.value = icon; return true; },
}));
import { forgetAccountAppIcon, pullAppIconFromAccount, pushAppIconToAccount, setAppIconAccount } from "./app-icon-sync";

const OWNER_KEY = "notefable:app-icon-owner";
const PENDING_KEY = "notefable:app-icon-pending";
const UPDATED = "2026-11-22T00:00:00.000Z";
const fetchMock = vi.fn();
const storage = new Map<string, string>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(init.body).icon);
const offline = () => Promise.reject(new TypeError("offline"));
// サーバーの代わり: GET は remote を返し、PUT は保存して account を返す。
function server(remote: { icon: string | null; updatedAt: string | null }, account = "acct-a") {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      remote = { icon: JSON.parse(String(init.body)).icon, updatedAt: UPDATED };
      return Promise.resolve(json({ ...remote, account }));
    }
    return Promise.resolve(json({ ...remote, account }));
  });
}

beforeEach(() => {
  // 前のテストのログイン状態・持ち主を消す（モジュールの状態はテストをまたいで残る）。
  forgetAccountAppIcon();
  fetchMock.mockReset();
  local.save.mockReset();
  local.value = null;
  storage.clear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  });
  setAppIconAccount(true);
});

describe("pulling the account icon", () => {
  it("applies the account value on this device and remembers its owner", async () => {
    server({ icon: "character:sora", updatedAt: UPDATED });
    local.value = "character:loop";
    await pullAppIconFromAccount();
    expect(local.save).toHaveBeenCalledWith("character:sora");
    expect(storage.get(OWNER_KEY)).toBe("acct-a");
    expect(storage.has(PENDING_KEY)).toBe(false);
  });

  it("applies the default character from the account", async () => {
    server({ icon: null, updatedAt: UPDATED });
    local.value = "data:image/png;base64,AAAA";
    await pullAppIconFromAccount();
    expect(local.save).toHaveBeenCalledWith(null);
  });

  it("uploads a guest choice once when the account has none yet", async () => {
    server({ icon: null, updatedAt: null });
    local.value = "character:piko";
    await pullAppIconFromAccount();
    expect(puts()).toEqual(["character:piko"]);
    expect(local.save).not.toHaveBeenCalled();
    expect(storage.get(OWNER_KEY)).toBe("acct-a");
  });

  it("uploads nothing when neither side has chosen an icon", async () => {
    server({ icon: null, updatedAt: null });
    await pullAppIconFromAccount();
    expect(puts()).toEqual([]);
  });

  it("keeps this device's icon when the account cannot be read", async () => {
    fetchMock.mockImplementationOnce(offline).mockResolvedValueOnce(json({ error: "Could not load your icon." }, 503));
    local.value = "character:loop";
    await pullAppIconFromAccount();
    await pullAppIconFromAccount();
    expect(local.save).not.toHaveBeenCalled();
    expect(puts()).toEqual([]);
  });

  it("does nothing for a guest", async () => {
    setAppIconAccount(false);
    await pullAppIconFromAccount();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores the account value when the icon was changed while reading", async () => {
    let answer!: (response: Response) => void;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? Promise.resolve(json({ icon: "character:velo", account: "acct-a" })) : new Promise<Response>((resolve) => { answer = resolve; }));
    const pulling = pullAppIconFromAccount();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    local.value = "character:velo";
    await pushAppIconToAccount("character:velo");
    answer(json({ icon: "character:sora", updatedAt: UPDATED, account: "acct-a" }));
    await pulling;
    expect(local.save).not.toHaveBeenCalled();
  });
});

describe("a choice that has not reached the account yet", () => {
  it("is resent instead of being reverted by the account's older value", async () => {
    // 前に同期済み（持ち主 acct-a）。オフラインで Loop を選んだ。
    storage.set(OWNER_KEY, "acct-a");
    fetchMock.mockImplementation(offline);
    local.value = "character:loop";
    expect(await pushAppIconToAccount("character:loop")).toBe("Could not save your icon. Please try again.");
    expect(storage.get(PENDING_KEY)).toBe("1");

    // つながった。アカウントにはまだ古い Sora がある。
    server({ icon: "character:sora", updatedAt: UPDATED });
    await pullAppIconFromAccount();
    expect(local.save).not.toHaveBeenCalled();
    expect(local.value).toBe("character:loop");
    expect(puts().at(-1)).toBe("character:loop");
    expect(storage.has(PENDING_KEY)).toBe(false);
    expect(storage.get(OWNER_KEY)).toBe("acct-a");
  });

  it("stays pending when the resend fails too", async () => {
    storage.set(OWNER_KEY, "acct-a");
    storage.set(PENDING_KEY, "1");
    local.value = "character:loop";
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? Promise.resolve(json({ error: "busy" }, 503)) : Promise.resolve(json({ icon: "character:sora", updatedAt: UPDATED, account: "acct-a" })));
    await pullAppIconFromAccount();
    expect(local.value).toBe("character:loop");
    expect(storage.get(PENDING_KEY)).toBe("1");
  });

  it("is cleared by a later successful choice", async () => {
    fetchMock.mockImplementationOnce(offline);
    await pushAppIconToAccount("character:loop");
    expect(storage.get(PENDING_KEY)).toBe("1");
    server({ icon: "character:loop", updatedAt: UPDATED });
    await pushAppIconToAccount("character:orbit");
    expect(storage.has(PENDING_KEY)).toBe(false);
    expect(storage.get(OWNER_KEY)).toBe("acct-a");
  });
});

describe("switching accounts on one device", () => {
  it("does not seed another account's photo into a never-synced account", async () => {
    storage.set(OWNER_KEY, "acct-a");
    local.value = "data:image/png;base64,PHOTO";
    server({ icon: null, updatedAt: null }, "acct-b");
    await pullAppIconFromAccount();
    expect(puts()).toEqual([]);
    expect(local.value).toBeNull();
    expect(storage.has(OWNER_KEY)).toBe(false);
  });

  it("drops another account's pending choice instead of sending it", async () => {
    storage.set(OWNER_KEY, "acct-a");
    storage.set(PENDING_KEY, "1");
    local.value = "data:image/png;base64,PHOTO";
    server({ icon: "character:piko", updatedAt: UPDATED }, "acct-b");
    await pullAppIconFromAccount();
    expect(puts()).toEqual([]);
    expect(local.value).toBe("character:piko");
    expect(storage.get(OWNER_KEY)).toBe("acct-b");
    expect(storage.has(PENDING_KEY)).toBe(false);
  });

  it("resets an account's icon on explicit sign-out but keeps a guest choice", () => {
    storage.set(OWNER_KEY, "acct-a");
    local.value = "data:image/png;base64,PHOTO";
    forgetAccountAppIcon();
    expect(local.value).toBeNull();
    expect(storage.has(OWNER_KEY)).toBe(false);

    local.value = "character:piko";
    local.save.mockReset();
    forgetAccountAppIcon();
    expect(local.save).not.toHaveBeenCalled();
    expect(local.value).toBe("character:piko");
  });

  it("resets a pending choice on sign-out even before its owner is known", () => {
    storage.set(PENDING_KEY, "1");
    local.value = "character:loop";
    forgetAccountAppIcon();
    expect(local.value).toBeNull();
    expect(storage.has(PENDING_KEY)).toBe(false);
  });
});

describe("pushing a chosen icon", () => {
  it("sends the choice in order and reports success", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ account: "acct-a" })));
    const first = pushAppIconToAccount("character:sora");
    const second = pushAppIconToAccount(null);
    expect(await first).toBe("");
    expect(await second).toBe("");
    expect(puts()).toEqual(["character:sora", null]);
  });

  it("returns the server's reason when the save fails", async () => {
    fetchMock.mockResolvedValue(json({ error: "Your icon changed somewhere else. Try again." }, 409));
    expect(await pushAppIconToAccount("character:sora")).toBe("Your icon changed somewhere else. Try again.");
  });

  it("returns a fallback reason when offline", async () => {
    fetchMock.mockImplementation(offline);
    expect(await pushAppIconToAccount("character:sora")).toBe("Could not save your icon. Please try again.");
  });

  it("reports only the latest choice's failure", async () => {
    fetchMock.mockImplementationOnce(offline).mockResolvedValueOnce(json({ account: "acct-a" }));
    const first = pushAppIconToAccount("character:sora");
    const second = pushAppIconToAccount("character:loop");
    expect(await first).toBe("");
    expect(await second).toBe("");
  });

  it("stays quiet after signing out elsewhere", async () => {
    fetchMock.mockResolvedValue(json({ error: "Sign in to sync your icon." }, 401));
    expect(await pushAppIconToAccount("character:sora")).toBe("");
  });

  it("sends nothing for a guest and treats the choice as nobody's", async () => {
    storage.set(OWNER_KEY, "acct-a");
    setAppIconAccount(false);
    expect(await pushAppIconToAccount("character:sora")).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.has(OWNER_KEY)).toBe(false);
  });
});
