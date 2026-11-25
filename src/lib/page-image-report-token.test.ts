import { describe, expect, it } from "vitest";
import { issuePageImageReportToken, verifyPageImageReportToken } from "./page-image-report-token";

describe("page-image-report-token", () => {
  it("issues and verifies a signed report token bound to user, file path, and prompt", async () => {
    const path = "note-files/u1/00000000-0000-4000-8000-000000000001.png";
    const token = await issuePageImageReportToken("u1", { path, prompt: "A misty forest" });
    expect(await verifyPageImageReportToken(token, "u1")).toEqual({ path, prompt: "A misty forest" });
    // Rejects another user or tampered token.
    expect(await verifyPageImageReportToken(token, "u2")).toBeNull();
    expect(await verifyPageImageReportToken(`${token}x`, "u1")).toBeNull();
    expect(await verifyPageImageReportToken("", "u1")).toBeNull();
  });
});
