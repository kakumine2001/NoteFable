import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanInfo } from "@/lib/billing-client";

const state = vi.hoisted(() => ({ plan: null as PlanInfo | null }));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  useId: () => "plan-title",
  useState: (initial: unknown) => {
    if (initial === null) return [state.plan, vi.fn()];
    return [initial, vi.fn()];
  },
}));
vi.mock("@/components/i18n-provider", () => ({
  useI18n: () => ({
    tag: "en",
    t: (key: string, params?: Record<string, string | number>) =>
      params ? key.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? "")) : key,
  }),
}));

import { PlanSettings } from "./plan-settings";

function collectText(node: unknown): string {
  const raw = (function walk(value: unknown): string {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(walk).join(" ");
    if (value && typeof value === "object" && "props" in value) {
      const props = (value as { props?: Record<string, unknown> }).props;
      return props && "children" in props ? walk(props.children) : "";
    }
    return "";
  })(node);
  return raw.replace(/\s+/g, " ").trim();
}

describe("PlanSettings usage meters and copy", () => {
  beforeEach(() => {
    state.plan = null;
  });

  it("hides monthly image usage on Free plan and uses image generations wording", () => {
    state.plan = {
      plan: "free",
      provider: null,
      billing: true,
      priceJpy: 300,
      trialDays: 0,
      canManage: false,
      manageUrl: null,
      subscription: null,
      usage: {
        chat: { used: 3, limit: 40, period: "day", resetsAt: "2026-11-22T00:00:00Z" },
        image: { used: 4, limit: 20, period: "month", resetsAt: "2026-12-01T00:00:00Z", daily: { used: 1, limit: 5, resetsAt: "2026-11-22T00:00:00Z" } },
      },
    };
    const text = collectText(PlanSettings());
    expect(text).toContain("Messages today");
    expect(text).toContain("3 / 40");
    expect(text).toContain("Image generations today");
    expect(text).toContain("1 / 5");
    expect(text).not.toContain("Image generations this month");
    expect(text).not.toContain("4 / 20");
    expect(text).toContain("2,000 messages and 60 image generations a month. Cancel anytime.");
  });

  it("shows monthly image usage on Free plan once the monthly cap is reached", () => {
    state.plan = {
      plan: "free",
      provider: null,
      billing: true,
      priceJpy: 300,
      trialDays: 0,
      canManage: false,
      manageUrl: null,
      subscription: null,
      usage: {
        chat: { used: 0, limit: 40, period: "day", resetsAt: "2026-11-22T00:00:00Z" },
        image: { used: 20, limit: 20, period: "month", resetsAt: "2026-12-01T00:00:00Z", daily: { used: 0, limit: 5, resetsAt: "2026-11-22T00:00:00Z" } },
      },
    };
    const text = collectText(PlanSettings());
    expect(text).toContain("Image generations this month 20 / 20");
    expect(text).toContain("Image generations today 0 / 5");
  });

  it("shows both period and daily image generation meters on Pro plan", () => {
    state.plan = {
      plan: "pro",
      provider: "stripe",
      billing: true,
      priceJpy: 300,
      trialDays: 0,
      canManage: true,
      manageUrl: null,
      subscription: null,
      usage: {
        chat: { used: 120, limit: 2000, period: "month", resetsAt: "2026-12-21T00:00:00Z" },
        image: { used: 12, limit: 60, period: "month", resetsAt: "2026-12-21T00:00:00Z", daily: { used: 2, limit: 10, resetsAt: "2026-11-22T00:00:00Z" } },
      },
    };
    const text = collectText(PlanSettings());
    expect(text).toContain("Messages this period");
    expect(text).toContain("Image generations this period");
    expect(text).toContain("12 / 60");
    expect(text).toContain("Image generations today");
    expect(text).toContain("2 / 10");
  });
});
