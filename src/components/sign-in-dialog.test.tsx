import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanLoginCode, normalizeDecimalDigits } from "@/lib/login-code";
import { SignInDialog } from "./sign-in-dialog";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  useRef: vi.fn(() => ({ current: { showModal: vi.fn() } })),
  useState: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("@/components/i18n-provider", () => ({
  useI18n: () => ({ locale: "ar", dir: "rtl", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/use-back-to-close", () => ({ useBackToClose: vi.fn() }));
vi.mock("@/lib/account-store", () => ({ useAccount: () => ({ account: { google: true, email: true } }) }));

type ElementLike = { type?: unknown; props?: Record<string, unknown> };

function findElement(node: unknown, predicate: (el: ElementLike) => boolean): ElementLike | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  const el = node as ElementLike;
  if (el.type && predicate(el)) return el;
  return el.props && "children" in el.props ? findElement(el.props.children, predicate) : null;
}

describe("normalizeDecimalDigits and cleanLoginCode", () => {
  it("normalizes Arabic-Indic, Extended Arabic-Indic, Devanagari, Thai, Fullwidth, and astral decimal digits to ASCII 0-9", () => {
    expect(normalizeDecimalDigits("٤٨٢٩١٠")).toBe("482910");
    expect(normalizeDecimalDigits("۴۸۲۹۱۰")).toBe("482910");
    expect(normalizeDecimalDigits("४८२९१०")).toBe("482910");
    expect(normalizeDecimalDigits("๔๘๒๙๑๐")).toBe("482910");
    expect(normalizeDecimalDigits("４８２９１０")).toBe("482910");
    expect(normalizeDecimalDigits("𝟒𝟖𝟐𝟗𝟏𝟎")).toBe("482910");
    expect(normalizeDecimalDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });

  it("strips non-digits and keeps at most six normalized ASCII digits", () => {
    expect(cleanLoginCode("٤٨٢٩١٠")).toBe("482910");
    expect(cleanLoginCode("٤٨٢ ٩١٠")).toBe("482910");
    expect(cleanLoginCode("۴۸۲-۹۱۰-۷۷")).toBe("482910");
    expect(cleanLoginCode("12 34-56 78")).toBe("123456");
    expect(cleanLoginCode("abc")).toBe("");
  });
});

describe("SignInDialog 6-digit code input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts Arabic-Indic digits, enables the Sign in button, and posts ASCII digits to /api/auth/email/verify", async () => {
    let currentCode = "";
    const renderCodeStep = () => {
      let slot = 0;
      const states: [unknown, (next: unknown) => void][] = [
        [false, vi.fn()], // google.failed
        ["code", vi.fn()], // step
        ["user@example.com", vi.fn()], // email
        ["user@example.com", vi.fn()], // sentTo
        [currentCode, (next: unknown) => { currentCode = String(next); }], // code
        [false, vi.fn()], // busy
        ["", vi.fn()], // error
        ["", vi.fn()], // notice
      ];
      vi.mocked(useState).mockImplementation(() => states[slot++] as unknown as ReturnType<typeof useState>);
      return SignInDialog({ onClose: vi.fn() });
    };

    const initialTree = renderCodeStep();
    const initialInput = findElement(initialTree, (el) => el.type === "input" && el.props?.["aria-label"] === "6-digit code")!;
    const initialSubmit = findElement(initialTree, (el) => el.type === "button" && el.props?.type === "submit")!;
    expect(initialSubmit.props?.disabled).toBe(true);

    // User types/pastes Arabic-Indic digits with a space.
    (initialInput.props?.onChange as (e: { target: { value: string } }) => void)({ target: { value: "٤٨٢ ٩١٠" } });
    expect(currentCode).toBe("482910");

    const updatedTree = renderCodeStep();
    const updatedInput = findElement(updatedTree, (el) => el.type === "input" && el.props?.["aria-label"] === "6-digit code")!;
    const updatedSubmit = findElement(updatedTree, (el) => el.type === "button" && el.props?.type === "submit")!;
    expect(updatedInput.props?.value).toBe("482910");
    expect(updatedSubmit.props?.disabled).toBe(false);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { reload: vi.fn() } });
    const form = findElement(updatedTree, (el) => el.type === "form")!;
    (form.props?.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/email/verify", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", code: "482910" }),
    }));
  });
});
