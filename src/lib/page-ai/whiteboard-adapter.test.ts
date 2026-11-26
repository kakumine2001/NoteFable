import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {}, databaseSchema: "notefable" }));
import { validateCanvasData } from "@/lib/canvas-document";
import { AdapterError, type AdapterPage } from "@/lib/page-ai/adapter";
import { whiteboardAdapter } from "@/lib/page-ai/whiteboard-adapter";

const ctx = { userId: "u1", sessionId: "s1", excludeMessageIds: [] };
const updatedAt = new Date("2026-11-26T00:00:00Z");

// OpenAI / DeepSeek strict: true requires every object schema to set additionalProperties: false and list every property in required.
function assertStrictSchema(schema: Record<string, unknown>, path = "$") {
  if (schema.type === "object") {
    expect(schema.additionalProperties, `${path}.additionalProperties`).toBe(false);
    const props = Object.keys((schema.properties ?? {}) as Record<string, unknown>).sort();
    const req = [...((schema.required ?? []) as string[])].sort();
    expect(req, `${path}.required`).toEqual(props);
    for (const [k, v] of Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>)) {
      // Never ask the model for raw pixel coordinates!
      expect(["x", "y", "width", "height"], `${path}.${k} must not expose raw coordinates`).not.toContain(k);
      assertStrictSchema(v, `${path}.${k}`);
    }
  }
  if (schema.items && typeof schema.items === "object") {
    assertStrictSchema(schema.items as Record<string, unknown>, `${path}[]`);
  }
}

describe("whiteboardAdapter", () => {
  it("uses fixed tool names and OpenAI/DeepSeek strict-compatible schemas with zero coordinate parameters", () => {
    expect(whiteboardAdapter.kind).toBe("whiteboard");
    expect(whiteboardAdapter.needsData).toBe(true);
    expect(whiteboardAdapter.create?.tool.name).toBe("propose_whiteboard_create");
    expect(whiteboardAdapter.edit?.tool.name).toBe("propose_whiteboard_edit");
    expect(whiteboardAdapter.create?.direct).toBeFalsy();

    assertStrictSchema(whiteboardAdapter.create!.tool.parameters);
    assertStrictSchema(whiteboardAdapter.edit!.tool.parameters);
  });

  it("proposes creating a whiteboard from Mermaid diagrams, structured items, or empty", async () => {
    const fromMermaid = await whiteboardAdapter.create!.propose(ctx, {
      title: "Login Flow",
      icon: "🗺️",
      parentId: null,
      mermaid: "flowchart LR\n  A[User] --> B[Auth]\n  B --> C[App]",
      frames: null,
      items: null,
      connections: null,
    });
    expect(fromMermaid.title).toBe("Login Flow");
    expect(fromMermaid.icon).toBe("🗺️");
    expect(fromMermaid.focusIds?.length).toBeGreaterThan(0);
    expect(() => validateCanvasData("whiteboard", fromMermaid.proposed.data)).not.toThrow();

    const fromStructured = await whiteboardAdapter.create!.propose(ctx, {
      title: "Sprint Board",
      icon: null,
      parentId: "p_parent",
      mermaid: null,
      frames: [{ ref: "todo", name: "To Do", layout: "column" }],
      items: [{ ref: "t1", type: "stickynote", text: "Ship WA2", color: "yellow", frameRef: "todo" }],
      connections: null,
    });
    expect(fromStructured.parentId).toBe("p_parent");
    expect(fromStructured.content).toContain('Frame "To Do"');
    expect(() => validateCanvasData("whiteboard", fromStructured.proposed.data)).not.toThrow();

    const empty = await whiteboardAdapter.create!.propose(ctx, {
      title: "Blank",
      icon: null,
      parentId: null,
      mermaid: null,
      frames: null,
      items: null,
      connections: null,
    });
    expect(empty.proposed.data).toEqual({ elements: [] });

    await expect(
      whiteboardAdapter.create!.propose(ctx, {
        title: "Mixed",
        icon: null,
        parentId: null,
        mermaid: "flowchart LR\n  A --> B",
        frames: null,
        items: [{ ref: "i1", type: "rectangle", text: "X", color: null, frameRef: null }],
        connections: null,
      }),
    ).rejects.toThrow(AdapterError);
  });

  it("proposes edits, tracks focusIds, supports renaming, and flags no-ops as unchanged", async () => {
    const created = await whiteboardAdapter.create!.propose(ctx, {
      title: "Plan",
      icon: null,
      parentId: null,
      mermaid: null,
      frames: null,
      items: [{ ref: "a", type: "rectangle", text: "Step 1", color: "blue", frameRef: null }],
      connections: null,
    });

    const page: AdapterPage = {
      id: "wb1",
      kind: "whiteboard",
      title: "Plan",
      icon: null,
      version: 1,
      updatedAt,
      blocks: [],
      data: created.proposed.data,
    };

    const noop = await whiteboardAdapter.edit!.propose(ctx, page, {
      noteId: "wb1",
      version: 1,
      title: null,
      operations: [],
    });
    expect(noop.unchanged).toBe(true);

    const edited = await whiteboardAdapter.edit!.propose(ctx, page, {
      noteId: "wb1",
      version: 1,
      title: "Updated Plan",
      operations: [
        {
          op: "add_element",
          ref: "s2",
          elementType: "rectangle",
          elementId: null,
          elementIds: null,
          text: "Step 2",
          color: "green",
          strokeStyle: null,
          fontSize: null,
          fromId: null,
          toId: null,
          frameId: null,
          nearId: null,
          placement: "right",
          layout: null,
          ungroup: null,
        },
      ],
    });
    expect(edited.unchanged).toBe(false);
    expect(edited.title).toEqual({ before: "Plan", after: "Updated Plan" });
    expect(edited.changes).toHaveLength(1);
    expect(edited.focusIds?.length).toBe(1);
    expect(() => validateCanvasData("whiteboard", edited.proposed.data)).not.toThrow();
  });
});
