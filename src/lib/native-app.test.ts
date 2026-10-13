import { afterEach, describe, expect, it, vi } from "vitest";
import { canSignInNatively, signInWithNativeGoogle, signOutOfNativeGoogle } from "@/lib/native-app";

function installBridge(nativePromise: (plugin: string, method: string, options?: unknown) => Promise<unknown>) {
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, nativePromise } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native Google sign-in", () => {
  it("is unavailable in a normal browser", () => {
    vi.stubGlobal("window", {});
    expect(canSignInNatively()).toBe(false);
  });

  it("is available inside the Android app", () => {
    installBridge(async () => ({}));
    expect(canSignInNatively()).toBe(true);
  });

  it("gets a nonce, signs in with it (no scopes), then sends the ID token to the server", async () => {
    const calls: [string, string, unknown][] = [];
    installBridge(async (plugin, method, options) => {
      calls.push([plugin, method, options]);
      return method === "login" ? { result: { idToken: "id-token" } } : undefined;
    });
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/nonce") ? ({ ok: true, json: async () => ({ nonce: "n-1" }) } as Response) : ({ ok: true } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(signInWithNativeGoogle("web-client-id")).resolves.toBe(true);

    expect(calls[0]).toEqual(["SocialLogin", "initialize", { google: { webClientId: "web-client-id" } }]);
    expect(calls[1]).toEqual(["SocialLogin", "login", { provider: "google", options: { nonce: "n-1" } }]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/native-auth/nonce", "/api/native-auth/google"]);
    const init = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init[1].body))).toEqual({ idToken: "id-token" });
  });

  it("returns false without calling the server when the user closes the account picker", async () => {
    installBridge(async (_plugin, method) => {
      if (method === "login") throw Object.assign(new Error("cancelled"), { code: "USER_CANCELLED" });
    });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ nonce: "n-1" }) }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(signInWithNativeGoogle("web-client-id")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/native-auth/google", expect.anything());
  });

  it("throws when the server rejects the token or Google returns none", async () => {
    installBridge(async (_plugin, method) => (method === "login" ? { result: { idToken: "id-token" } } : undefined));
    const nonceThenReject = vi.fn(async (url: string) =>
      url.endsWith("/nonce") ? ({ ok: true, json: async () => ({ nonce: "n-1" }) } as Response) : ({ ok: false } as Response),
    );
    vi.stubGlobal("fetch", nonceThenReject);
    await expect(signInWithNativeGoogle("web-client-id")).rejects.toThrow("rejected");

    installBridge(async (_plugin, method) => (method === "login" ? { result: {} } : undefined));
    await expect(signInWithNativeGoogle("web-client-id")).rejects.toThrow("ID token");

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response));
    await expect(signInWithNativeGoogle("web-client-id")).rejects.toThrow("Could not start");
  });

  it("ignores sign-out failures", async () => {
    installBridge(async () => {
      throw new Error("not signed in");
    });
    await expect(signOutOfNativeGoogle()).resolves.toBeUndefined();
  });
});
