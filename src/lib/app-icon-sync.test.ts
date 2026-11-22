import { beforeEach, describe, expect, it, vi } from "vitest";

const local = vi.hoisted(() => ({ value: null as string | null, save: vi.fn() }));
vi.mock("@/lib/app-icon", async (original) => ({
  ...(await original<typeof import("@/lib/app-icon")>()),
  readAppIcon: () => local.value,
  saveAppIcon: (icon: string | null) => { local.save(icon); local.value = icon; return true; },
}));
import { pullAppIconFromAccount, pushAppIconToAccount, setAppIconAccount } from "./app-icon-sync";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(init.body).icon);

beforeEach(() => {
  fetchMock.mockReset();
  local.save.mockReset();
  local.value = null;
  vi.stubGlobal("fetch", fetchMock);
  setAppIconAccount(true);
});

describe("pulling the account icon", () => {
  it("applies the account value on this device", async () => {
    fetchMock.mockResolvedValue(json({ icon: "character:sora", updatedAt: "2026-11-22T00:00:00.000Z" }));
    local.value = "character:loop";
    await pullAppIconFromAccount();
    expect(local.save).toHaveBeenCalledWith("character:sora");
  });

  it("applies the default character from the account", async () => {
    fetchMock.mockResolvedValue(json({ icon: null, updatedAt: "2026-11-22T00:00:00.000Z" }));
    local.value = "data:image/png;base64,AAAA";
    await pullAppIconFromAccount();
    expect(local.save).toHaveBeenCalledWith(null);
  });

  it("uploads this device's icon once when the account has none yet", async () => {
    fetchMock.mockResolvedValueOnce(json({ icon: null, updatedAt: null })).mockResolvedValueOnce(json({ icon: "character:piko" }));
    local.value = "character:piko";
    await pullAppIconFromAccount();
    expect(puts()).toEqual(["character:piko"]);
    expect(local.save).not.toHaveBeenCalled();
  });

  it("uploads nothing when neither side has chosen an icon", async () => {
    fetchMock.mockResolvedValue(json({ icon: null, updatedAt: null }));
    await pullAppIconFromAccount();
    expect(puts()).toEqual([]);
  });

  it("keeps this device's icon when the account cannot be read", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(json({ error: "Could not load your icon." }, 503));
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
      init?.method === "PUT" ? Promise.resolve(json({ icon: "character:velo" })) : new Promise<Response>((resolve) => { answer = resolve; }));
    const pulling = pullAppIconFromAccount();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    local.value = "character:velo";
    await pushAppIconToAccount("character:velo");
    answer(json({ icon: "character:sora", updatedAt: "2026-11-22T00:00:00.000Z" }));
    await pulling;
    expect(local.save).not.toHaveBeenCalled();
  });
});

describe("pushing a chosen icon", () => {
  it("sends the choice in order and reports success", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({})));
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
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await pushAppIconToAccount("character:sora")).toBe("Could not save your icon. Please try again.");
  });

  it("reports only the latest choice's failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(json({}));
    const first = pushAppIconToAccount("character:sora");
    const second = pushAppIconToAccount("character:loop");
    expect(await first).toBe("");
    expect(await second).toBe("");
  });

  it("stays quiet after signing out elsewhere", async () => {
    fetchMock.mockResolvedValue(json({ error: "Sign in to sync your icon." }, 401));
    expect(await pushAppIconToAccount("character:sora")).toBe("");
  });

  it("sends nothing for a guest", async () => {
    setAppIconAccount(false);
    expect(await pushAppIconToAccount("character:sora")).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
