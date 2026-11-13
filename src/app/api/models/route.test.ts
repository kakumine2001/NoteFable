import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL, MODEL_OPTIONS } from "@/lib/models";
import { GET } from "./route";

describe("GET /api/models", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers only the models the server enables through STUDYMATE_MODELS, in that order", async () => {
    const [first, second] = MODEL_OPTIONS;
    vi.stubEnv("STUDYMATE_MODELS", JSON.stringify([{ id: second.id, label: "Renamed", upstreamModel: "secret-upstream" }, { id: first.id, enabled: false }]));
    const body = await GET().json();

    expect(body.defaultModel).toBe(second.id);
    expect(body.models).toHaveLength(1);
    expect(body.models[0].label).toBe("Renamed");
    // 上游模型名是服务器内部信息，不发给客户端。
    expect(JSON.stringify(body)).not.toContain("secret-upstream");
  });

  it("exposes the model list from src/lib/models.ts without secrets", async () => {
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.defaultModel).toBe(DEFAULT_MODEL);
    expect(body.models.map((model: { id: string }) => model.id)).toEqual(MODEL_OPTIONS.map((model) => model.id));
    // 只暴露客户端需要的字段，不带服务端内部限制（tokenLimits 等）。
    expect(Object.keys(body.models[0]).sort()).toEqual([
      "defaultReasoning",
      "id",
      "label",
      "provider",
      "reasoningEfforts",
      "supportsImageInput",
      "supportsWebSearch",
    ]);
  });

  it("only offers reasoning levels the model supports, with its default among them", async () => {
    const body = await GET().json();
    for (const model of body.models) {
      expect(model.reasoningEfforts).toContain(model.defaultReasoning);
    }
  });
});
