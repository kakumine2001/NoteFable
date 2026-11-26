import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { config as proxyConfig } from "../proxy";

const AASA_PATH = path.resolve(process.cwd(), "public/.well-known/apple-app-site-association");

describe("iOS Universal Links (apple-app-site-association)", () => {
  it("provides a valid AASA document matching only single-segment /c/<id> conversation share links", () => {
    const raw = readFileSync(AASA_PATH, "utf8");
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThan(128 * 1024);

    const parsed = JSON.parse(raw) as {
      applinks?: {
        details?: Array<{
          appIDs?: string[];
          components?: Array<{ "/"?: string; exclude?: boolean }>;
        }>;
      };
    };

    expect(parsed.applinks?.details).toHaveLength(1);
    const detail = parsed.applinks!.details![0];
    expect(detail.appIDs).toEqual(["59KHKFY4WB.com.kakumine.notefable"]);
    expect(detail.components?.map((item) => ({ path: item["/"], exclude: Boolean(item.exclude) }))).toEqual([
      { path: "/c/*/?*", exclude: true },
      { path: "/c/?*", exclude: false },
    ]);
  });

  it("serves the extensionless AASA file with application/json Content-Type", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((item) => item.source === "/.well-known/apple-app-site-association");
    expect(rule).toBeDefined();
    expect(rule?.headers).toContainEqual({
      key: "Content-Type",
      value: "application/json",
    });
  });

  it("does not intercept /.well-known/apple-app-site-association in proxy matcher", () => {
    expect(proxyConfig.matcher).not.toContain("/.well-known/apple-app-site-association");
    expect(proxyConfig.matcher).not.toContain("/.well-known/:path*");
  });
});
