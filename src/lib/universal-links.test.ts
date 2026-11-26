import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { config as proxyConfig } from "../proxy";
import { routeLocalizedRequest } from "./i18n/routing";

const require = createRequire(import.meta.url);
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (pattern: string) => RegExp;
};

const AASA_URL_PATH = "/.well-known/apple-app-site-association";
const AASA_FILE_PATH = path.resolve(process.cwd(), "public/.well-known/apple-app-site-association");

describe("iOS Universal Links (apple-app-site-association)", () => {
  it("provides a valid AASA document matching only single-segment /c/<id> conversation share links", () => {
    const raw = readFileSync(AASA_FILE_PATH, "utf8");
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
    const rule = rules.find((item) => item.source === AASA_URL_PATH);
    expect(rule).toBeDefined();
    expect(rule?.headers).toContainEqual({
      key: "Content-Type",
      value: "application/json",
    });
  });

  it("is not intercepted by proxy matchers or localized routing", () => {
    const matched = proxyConfig.matcher.some((entry) => {
      const pattern = typeof entry === "string" ? entry : (entry as { source: string }).source;
      return pathToRegexp(pattern).test(AASA_URL_PATH);
    });
    expect(matched).toBe(false);

    const route = routeLocalizedRequest(
      {
        url: `https://app.notefable.com${AASA_URL_PATH}`,
        cookie: () => undefined,
        header: () => null,
      },
      {
        site: "https://notefable.com",
        app: "https://app.notefable.com",
        siteHost: "notefable.com",
        appHost: "app.notefable.com",
        cookieDomain: "notefable.com",
      },
    );
    expect(route.kind).toBe("none");
  });
});
