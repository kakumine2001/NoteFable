import { describe, expect, it } from "vitest";
import { UsageLimitError, usageLimitErrorFrom } from "./usage-plans";

describe("usageLimitErrorFrom", () => {
  it("recognizes the daily limit response", () => {
    const error = usageLimitErrorFrom(429, { error: "limit", code: "usage_limit", tier: "guest", kind: "image" });
    expect(error).toBeInstanceOf(UsageLimitError);
    expect(error).toMatchObject({ message: "limit", tier: "guest", kind: "image" });
    expect(usageLimitErrorFrom(429, { error: "limit", code: "usage_limit", tier: "member" })?.kind).toBe("chat");
  });

  it("ignores other errors", () => {
    expect(usageLimitErrorFrom(500, { error: "x", code: "usage_limit", tier: "guest" })).toBeNull();
    expect(usageLimitErrorFrom(429, { error: "x" })).toBeNull();
    expect(usageLimitErrorFrom(429, { error: "x", code: "usage_limit", tier: "admin" })).toBeNull();
    expect(usageLimitErrorFrom(429, null)).toBeNull();
  });
});
