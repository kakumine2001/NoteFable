import { describe, expect, it } from "vitest";
import { normalizeDatabaseSslMode, withDatabaseSchema } from "./database-url";

describe("database SSL configuration", () => {
  it.each(["prefer", "require", "verify-ca"])("keeps full verification for %s", (mode) => {
    const original = new URL(`postgresql://user:p%40ss@db.example/app?schema=notefable&sslmode=${mode}&channel_binding=require`);
    const result = new URL(normalizeDatabaseSslMode(original.toString()));

    expect(result.searchParams.get("sslmode")).toBe("verify-full");
    result.searchParams.set("sslmode", mode);
    expect(result.toString()).toBe(original.toString());
  });

  it.each([
    "postgresql://localhost/app?schema=public",
    "postgresql://localhost/app?sslmode=disable",
    "postgresql://db.example/app?sslmode=verify-full",
    "postgresql://db.example/app?sslmode=require&uselibpqcompat=true",
  ])("preserves explicit or non-TLS configuration: %s", (url) => {
    expect(normalizeDatabaseSslMode(url)).toBe(url);
  });
});

describe("database schema", () => {
  it("always uses the notefable schema, whatever the URL says", () => {
    const url = new URL(withDatabaseSchema("postgresql://user:p%40ss@db.example/neondb?schema=public&sslmode=verify-full"));
    expect(url.searchParams.get("schema")).toBe("notefable");
    expect(url.searchParams.get("sslmode")).toBe("verify-full");
    expect(url.password).toBe("p%40ss");
  });
});
