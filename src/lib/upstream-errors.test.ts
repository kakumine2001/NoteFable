import { describe, expect, it } from "vitest";
import { buildUpstreamErrorMessage, sanitizeErrorMessage } from "./upstream-errors";

describe("buildUpstreamErrorMessage", () => {
  it("uses provider and status when the response body is empty", () => {
    expect(buildUpstreamErrorMessage("OpenAI", 503, "  \n ")).toBe(
      "OpenAI request failed with HTTP 503.",
    );
  });

  it("compacts safe upstream text", () => {
    expect(buildUpstreamErrorMessage("OpenAI", 400, " invalid\n  request ")).toBe(
      "invalid request",
    );
  });

  it("does not expose HTML error pages", () => {
    expect(buildUpstreamErrorMessage("OpenAI", 502, "<!doctype html><h1>Gateway</h1>"))
      .toBe("OpenAI returned an HTML error page. Try again later.");
  });

  it("limits long upstream messages", () => {
    const message = buildUpstreamErrorMessage("OpenAI", 500, "a".repeat(300));

    expect(message).toHaveLength(243);
    expect(message.endsWith("...")).toBe(true);
  });
});

describe("sanitizeErrorMessage", () => {
  it("uses Error messages and falls back for unknown values", () => {
    expect(sanitizeErrorMessage(new Error("temporary failure"))).toBe("temporary failure");
    expect(sanitizeErrorMessage(null, "safe fallback")).toBe("safe fallback");
  });
});
