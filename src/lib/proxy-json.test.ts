import { describe, expect, it } from "vitest";
import { stringifyJsonForProxy } from "./proxy-json";

describe("stringifyJsonForProxy", () => {
  it("preserves ordinary ASCII JSON", () => {
    const value = { model: "gpt-5.5", enabled: true, count: 2 };

    expect(stringifyJsonForProxy(value)).toBe(JSON.stringify(value));
  });

  it("escapes Chinese text while preserving its parsed value", () => {
    const value = { prompt: "解释这道题" };
    const body = stringifyJsonForProxy(value);

    expect(body).toMatch(/^[\x00-\x7F]*$/);
    expect(body).toContain("\\u89e3");
    expect(JSON.parse(body)).toEqual(value);
  });

  it("escapes both halves of an emoji surrogate pair", () => {
    const value = { prompt: "Study 📚" };
    const body = stringifyJsonForProxy(value);

    expect(body).toMatch(/^[\x00-\x7F]*$/);
    expect(body).toContain("\\ud83d\\udcda");
    expect(JSON.parse(body)).toEqual(value);
  });
});
