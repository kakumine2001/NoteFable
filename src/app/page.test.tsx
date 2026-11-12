import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/components/thread-landing", () => ({ ThreadLanding: () => null }));

import Home from "./page";
import { ThreadLanding } from "@/components/thread-landing";

describe("homepage routing", () => {
  it("shows the introduction on ordinary visits, including campaign links", async () => {
    for (const params of [{}, { utm_source: "bookmark" }]) {
      const result = await Home({ searchParams: Promise.resolve(params) });
      expect(result.type).toBe(ThreadLanding);
    }
  });

  it.each(["chat", "message", "view", "page"])("keeps legacy %s links in the workspace", async (key) => {
    await expect(Home({ searchParams: Promise.resolve({ [key]: "existing-id" }) }))
      .rejects.toThrow(`REDIRECT:/app?${key}=existing-id`);
  });

  it("preserves all legacy link parameters, repeated values, and Unicode", async () => {
    await expect(Home({ searchParams: Promise.resolve({
      chat: "chat-id", message: "message-id", extra: ["中文", "a&b"], absent: undefined,
    }) })).rejects.toThrow("REDIRECT:/app?chat=chat-id&message=message-id&extra=%E4%B8%AD%E6%96%87&extra=a%26b");
  });

  it("still routes incomplete legacy links through the workspace's existing fallback", async () => {
    await expect(Home({ searchParams: Promise.resolve({ chat: "" }) }))
      .rejects.toThrow("REDIRECT:/app?chat=");
  });
});
