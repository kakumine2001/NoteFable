import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {}, databaseSchema: "notefable" }));
import { validateCanvasData } from "@/lib/canvas-document";
import { AdapterError, type AdapterPage } from "@/lib/page-ai/adapter";
import { slidesAdapter } from "@/lib/page-ai/slides-adapter";

const ctx = { userId: "u1", sessionId: "s1", excludeMessageIds: [] };
const updatedAt = new Date("2026-11-26T00:00:00Z");

const NULL_OP = {
  slideId: null,
  slideIds: null,
  afterSlideId: null,
  atStart: null,
  ref: null,
  title: null,
  body: null,
  notes: null,
  layout: null,
  hidden: null,
  transition: null,
  section: null,
  secondTitle: null,
  secondBody: null,
  secondNotes: null,
  secondLayout: null,
  themeId: null,
  themeMode: null,
  slideLayouts: null,
};

// OpenAI / DeepSeek strict: true requires every object schema to set additionalProperties: false and list every property in required.
function assertStrictSchema(schema: Record<string, unknown>, path = "$") {
  if (schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object"))) {
    expect(schema.additionalProperties, `${path}.additionalProperties`).toBe(false);
    const props = Object.keys((schema.properties ?? {}) as Record<string, unknown>).sort();
    const req = [...((schema.required ?? []) as string[])].sort();
    expect(req, `${path}.required`).toEqual(props);
    for (const [k, v] of Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>)) {
      // Never ask the model for raw pixel coordinates!
      expect(["x", "y", "w", "h", "width", "height", "rotation"], `${path}.${k} must not expose raw coordinates`).not.toContain(k);
      assertStrictSchema(v, `${path}.${k}`);
    }
  }
  if (schema.items && typeof schema.items === "object") {
    assertStrictSchema(schema.items as Record<string, unknown>, `${path}[]`);
  }
}

describe("slidesAdapter", () => {
  it("uses fixed tool names and OpenAI/DeepSeek/Anthropic strict-compatible schemas with zero coordinate parameters", () => {
    expect(slidesAdapter.kind).toBe("slides");
    expect(slidesAdapter.needsData).toBe(true);
    expect(slidesAdapter.create?.tool.name).toBe("propose_slides_create");
    expect(slidesAdapter.edit?.tool.name).toBe("propose_slides_edit");
    expect(slidesAdapter.create?.direct).toBeFalsy();

    assertStrictSchema(slidesAdapter.create!.tool.parameters);
    assertStrictSchema(slidesAdapter.edit!.tool.parameters);
  });

  it("proposes creating a slide deck with theme, slides, icon, and parentId, and rejects bad inputs", async () => {
    const created = await slidesAdapter.create!.propose(ctx, {
      title: "Q4 Review",
      icon: "📊",
      parentId: "p_parent",
      theme: { themeId: "editorial", mode: "dark" },
      slides: [
        { title: "Q4 Review", body: "Highlights & Metrics", notes: "Open strongly.", layout: "title", section: null },
        { title: "Metrics", body: "- ARR +40%\n- Churn -12%", notes: null, layout: "bullets", section: "Results" },
      ],
    });

    expect(created.title).toBe("Q4 Review");
    expect(created.icon).toBe("📊");
    expect(created.parentId).toBe("p_parent");
    expect(created.content).toContain("Theme: editorial (dark)");
    expect(created.changes?.length).toBe(2);
    expect(created.focusIds?.length).toBe(2);
    expect(() => validateCanvasData("slides", created.proposed.data)).not.toThrow();

    await expect(
      slidesAdapter.create!.propose(ctx, {
        title: "   ",
        icon: null,
        parentId: null,
        theme: { themeId: null, mode: null },
        slides: [],
      }),
    ).rejects.toThrow(AdapterError);

    await expect(
      slidesAdapter.create!.propose(ctx, {
        title: "Deck",
        icon: "not-an-emoji",
        parentId: null,
        theme: { themeId: null, mode: null },
        slides: [],
      }),
    ).rejects.toThrow(AdapterError);
  });

  it("proposes edits, restyle_deck, renaming, focusIds, and flags no-ops as unchanged", async () => {
    const created = await slidesAdapter.create!.propose(ctx, {
      title: "Pitch",
      icon: null,
      parentId: null,
      theme: { themeId: "simple", mode: "light" },
      slides: [
        { title: "Pitch", body: "Seed Round", notes: null, layout: "title", section: null },
        { title: "Problem", body: "- Slow workflows", notes: "Keep crisp.", layout: "bullets", section: null },
      ],
    });
    const slides = (created.proposed.data as { slides: { id: string }[] }).slides;
    const page: AdapterPage = {
      id: "deck1",
      kind: "slides",
      title: "Pitch",
      icon: null,
      version: 1,
      updatedAt,
      blocks: [],
      data: created.proposed.data,
    };

    const noop = await slidesAdapter.edit!.propose(ctx, page, {
      noteId: "deck1",
      version: 1,
      title: null,
      operations: [],
    });
    expect(noop.unchanged).toBe(true);

    const edited = await slidesAdapter.edit!.propose(ctx, page, {
      noteId: "deck1",
      version: 1,
      title: "Pitch v2",
      operations: [
        { ...NULL_OP, op: "update_slide", slideId: slides[1].id, body: "- Slow manual workflows\n- Fragmented tools" },
        { ...NULL_OP, op: "restyle_deck", themeId: "geometric", themeMode: "dark" },
      ],
    });
    expect(edited.unchanged).toBe(false);
    expect(edited.title).toEqual({ before: "Pitch", after: "Pitch v2" });
    expect(edited.changes).toHaveLength(2);
    expect(edited.focusIds).toContain(slides[1].id);
    expect(() => validateCanvasData("slides", edited.proposed.data)).not.toThrow();

    await expect(
      slidesAdapter.edit!.propose(ctx, page, {
        noteId: "deck1",
        version: 1,
        title: null,
        operations: [{ ...NULL_OP, op: "update_slide", slideId: "nonexistent", title: "X" }],
      }),
    ).rejects.toThrow(AdapterError);
  });
});
