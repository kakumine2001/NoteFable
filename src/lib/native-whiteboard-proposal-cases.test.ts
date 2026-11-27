import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IOS_WHITEBOARD_PROPOSAL_CASES, NATIVE_WHITEBOARD_PROPOSAL_CASES, nativeWhiteboardProposalCases } from "../../scripts/native-whiteboard-proposal-cases";

describe("native whiteboard proposal text parity cases", () => {
  it("are up to date (regenerate with npx tsx scripts/gen-native-whiteboard-proposal-cases.ts)", () => {
    expect(readFileSync(NATIVE_WHITEBOARD_PROPOSAL_CASES, "utf8").replace(/\r\n/g, "\n")).toBe(nativeWhiteboardProposalCases());
  });

  it("the iOS copy is up to date (regenerate with npx tsx scripts/gen-native-whiteboard-proposal-cases.ts)", () => {
    expect(readFileSync(IOS_WHITEBOARD_PROPOSAL_CASES, "utf8").replace(/\r\n/g, "\n")).toBe(nativeWhiteboardProposalCases());
  });
});
