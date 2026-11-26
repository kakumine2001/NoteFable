import { describe, expect, it } from "vitest";
import { projectSettingsAttention, projectSettingsChanges, projectSettingsDismissStep } from "./project-settings-form";

const initial = { instructions: "Be brief", notes: [{ id: "a" }, { id: "b" }] };

describe("projectSettingsChanges", () => {
  it("reports nothing when nothing changed (surrounding spaces don't count)", () => {
    expect(projectSettingsChanges(initial, "  Be brief \n", ["a", "b"])).toEqual({});
    expect(projectSettingsChanges({ instructions: null, notes: [] }, "   ", [])).toEqual({});
  });

  it("sends only the fields that changed", () => {
    expect(projectSettingsChanges(initial, "Be detailed", ["a", "b"])).toEqual({ instructions: "Be detailed" });
    expect(projectSettingsChanges(initial, "Be brief", ["b", "a"])).toEqual({ noteIds: ["b", "a"] });
    expect(projectSettingsChanges(initial, "", ["a"])).toEqual({ instructions: "", noteIds: ["a"] });
  });
});

describe("projectSettingsDismissStep", () => {
  it("never closes while saving", () => {
    expect(projectSettingsDismissStep({ busy: true, dirty: false })).toBe("stay");
    expect(projectSettingsDismissStep({ busy: true, dirty: true })).toBe("stay");
  });

  it("asks before discarding unsaved changes and closes otherwise", () => {
    expect(projectSettingsDismissStep({ busy: false, dirty: true })).toBe("confirm");
    expect(projectSettingsDismissStep({ busy: false, dirty: false })).toBe("close");
  });
});

describe("projectSettingsAttention", () => {
  it("keeps the confirmation while changes remain", () => {
    expect(projectSettingsAttention(2, true)).toBe(2);
  });

  it("resets once the edits are reverted, so a new edit doesn't show the confirmation by itself", () => {
    const afterRevert = projectSettingsAttention(1, false);
    expect(afterRevert).toBe(0);
    expect(projectSettingsAttention(afterRevert, true)).toBe(0);
  });
});
