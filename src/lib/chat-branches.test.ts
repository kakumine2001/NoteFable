import { describe, expect, it } from "vitest";
import { ROOT_PARENT, activationFor, activeLeafId, buildTree, pathTo, subtreeIds, versionsOf, type BranchNode } from "./chat-branches";

let clock = 0;
function node(id: string, parentId: string | null, active = true, role = "USER"): BranchNode {
  clock += 1000;
  return { id, parentId, active, role, createdAt: new Date(clock) };
}

describe("chat branches", () => {
  it("treats rows without a parent as a chain in creation order", () => {
    const tree = buildTree([node("u1", null), node("a1", null), node("u2", null)]);
    expect(tree.parent.get("u1")).toBe(ROOT_PARENT);
    expect(tree.parent.get("a1")).toBe("u1");
    expect(tree.parent.get("u2")).toBe("a1");
    expect(versionsOf(tree).size).toBe(0);
    expect(activeLeafId(tree)).toBe("u2");
    expect(pathTo(tree, "u2")).toEqual(["u1", "a1", "u2"]);
  });

  it("sorts by creation time, then id, whatever order the rows arrive in", () => {
    const first = node("b", null);
    const second = { ...node("a", null), createdAt: first.createdAt };
    const tree = buildTree([first, second]);
    expect(tree.order.map((item) => item.id)).toEqual(["a", "b"]);
    expect(tree.parent.get("b")).toBe("a");
  });

  it("reports versions for an edited first message and a regenerated answer", () => {
    const tree = buildTree([
      node("u1", null, false), node("a1", null, false),
      // 先頭の発言を編集した版と、その回答を 2 回作り直した版。
      node("u1b", ROOT_PARENT), node("a2", "u1b", false), node("a3", "u1b", false), node("a4", "u1b"),
    ]);
    const versions = versionsOf(tree);
    expect(versions.get("u1b")).toEqual({ index: 2, total: 2, prevId: "u1", nextId: null });
    expect(versions.get("a4")).toEqual({ index: 3, total: 3, prevId: "a3", nextId: null });
    expect(versions.has("u1")).toBe(false);
    expect(activeLeafId(tree)).toBe("a4");
  });

  it("collects a message and everything below it", () => {
    const tree = buildTree([node("u1", null), node("a1", null), node("u2", null), node("a1b", "u1"), node("u3", "a1b")]);
    expect(subtreeIds(tree, "a1").sort()).toEqual(["a1", "u2"]);
    expect(subtreeIds(tree, "u1").sort()).toEqual(["a1", "a1b", "u1", "u2", "u3"]);
  });

  it("activates the ancestors of a version and the newest branch below it", () => {
    const tree = buildTree([
      node("u1", null), node("a1", null, false), node("u2", null, false), node("a2", null, false), node("a2b", "u2", false),
      node("a1b", "u1"), node("u3", "a1b"),
    ]);
    expect([...activationFor(tree, "a1")!].sort()).toEqual(["a1", "a2b", "u1", "u2"]);
    expect([...activationFor(tree, "a1b")!].sort()).toEqual(["a1b", "u1", "u3"]);
    expect(activationFor(tree, "missing")).toBeNull();
  });

  it("goes back to the version that was selected last below the chosen one, not just the newest", () => {
    // u1 の下に a1 と作り直した a1b。a1b を作ったあとで a1 を選び直している。
    const u1x = node("u1x", ROOT_PARENT);
    const a1 = { ...node("a1", "u1x", false), selectedAt: null as Date | null };
    const nodes = [u1x, a1, node("a1b", "u1x", false), node("u1y", ROOT_PARENT, false)];
    expect([...activationFor(buildTree(nodes), "u1x")!].sort()).toEqual(["a1b", "u1x"]);
    a1.selectedAt = new Date(clock + 1000);
    expect([...activationFor(buildTree(nodes), "u1x")!].sort()).toEqual(["a1", "u1x"]);
  });

  it("ignores a parent that is missing or was created later", () => {
    const tree = buildTree([node("u1", "gone"), node("a1", "u2"), node("u2", "a1")]);
    expect(tree.parent.get("u1")).toBe(ROOT_PARENT);
    expect(tree.parent.get("a1")).toBe("u1");
    expect(tree.parent.get("u2")).toBe("a1");
  });

  it("uses the conversation start when nothing is displayed", () => {
    expect(activeLeafId(buildTree([]))).toBe(ROOT_PARENT);
    expect(activeLeafId(buildTree([node("u1", null, false)]))).toBe(ROOT_PARENT);
  });
});
