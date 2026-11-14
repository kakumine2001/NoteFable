import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), remove: vi.fn(), project: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { chatProject: { findFirst: mocks.project }, session: { findFirst: mocks.find, updateMany: mocks.update, deleteMany: mocks.remove } } }));
import { DELETE, PATCH } from "./route";

const context = { params: Promise.resolve({ sessionId: "s1" }) };
const updatedAt = new Date("2026-10-14T00:00:00Z");
function patch(body: unknown) {
  return new Request("http://localhost/api/sessions/s1", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("chat icon", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("saves an emoji for the owner without moving the chat in the list", async () => {
    mocks.find.mockResolvedValue({ updatedAt });
    mocks.update.mockResolvedValue({ count: 1 });
    const response = await PATCH(patch({ icon: "📚" }) as never, context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, icon: "📚" });
    expect(mocks.find).toHaveBeenCalledWith({ where: { id: "s1", userId: "mine" }, select: { updatedAt: true } });
    // 更新日時が読んだ値のままのときだけ書く。回答の保存と同時でも、新しい更新日時を古い値で上書きしない。
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "s1", userId: "mine", updatedAt }, data: { icon: "📚", updatedAt } });
  });

  it("re-reads and retries when a reply is saved at the same moment", async () => {
    const newer = new Date("2026-10-14T00:00:05Z");
    mocks.find.mockResolvedValueOnce({ updatedAt }).mockResolvedValueOnce({ updatedAt: newer });
    mocks.update.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    expect((await PATCH(patch({ icon: "📚" }) as never, context)).status).toBe(200);
    expect(mocks.update.mock.calls.map(([arg]) => arg.data.updatedAt)).toEqual([updatedAt, newer]);
  });

  it("still saves the icon, without keeping the old order, when the chat keeps changing", async () => {
    mocks.find.mockResolvedValue({ updatedAt });
    mocks.update.mockResolvedValue({ count: 0 });
    mocks.update.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    expect((await PATCH(patch({ icon: "📚" }) as never, context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledTimes(4);
    expect(mocks.update.mock.calls[3][0]).toEqual({ where: { id: "s1", userId: "mine" }, data: { icon: "📚" } });
  });

  it("returns 404 when the chat is deleted while the icon is being saved", async () => {
    mocks.find.mockResolvedValueOnce({ updatedAt }).mockResolvedValueOnce(null);
    mocks.update.mockResolvedValueOnce({ count: 0 });
    expect((await PATCH(patch({ icon: "📚" }) as never, context)).status).toBe(404);
  });

  it("clears the icon with null", async () => {
    mocks.find.mockResolvedValue({ updatedAt });
    mocks.update.mockResolvedValue({ count: 1 });
    expect((await PATCH(patch({ icon: null }) as never, context)).status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data.icon).toBeNull();
  });

  it.each([["abc"], ["📚📚"], ["📚a"], [""], [5], [undefined]])("rejects %j as an icon", async (icon) => {
    expect((await PATCH(patch({ icon }) as never, context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed body", async () => {
    expect((await PATCH(patch("not json") as never, context)).status).toBe(400);
    expect((await PATCH(patch({}) as never, context)).status).toBe(400);
  });

  it("does not touch a chat that belongs to another device", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await PATCH(patch({ icon: "📚" }) as never, context)).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});


describe("chat organization", () => {
  beforeEach(()=>{vi.clearAllMocks();mocks.find.mockResolvedValue({updatedAt});mocks.update.mockResolvedValue({count:1});});
  it("keeps a manual title and does not reorder history",async()=>{
    const response=await PATCH(patch({title:"  Study plan  "}) as never,context);
    expect(response.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toEqual({title:"Study plan",titleManual:true,updatedAt});
  });
  it.each([{title:" "},{title:"x".repeat(121)},{pinned:"yes"},{projectId:3}])("rejects invalid metadata %j",async body=>{
    expect((await PATCH(patch(body) as never,context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("refuses a project belonging to another user",async()=>{
    mocks.project.mockResolvedValue(null);
    expect((await PATCH(patch({projectId:"foreign"}) as never,context)).status).toBe(404);
    expect(mocks.project).toHaveBeenCalledWith({where:{id:"foreign",userId:"mine"},select:{id:true}});
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("moves and pins an owned conversation",async()=>{
    mocks.project.mockResolvedValue({id:"project"});
    expect((await PATCH(patch({projectId:"project",pinned:true}) as never,context)).status).toBe(200);
    expect(mocks.update.mock.calls[0][0]).toEqual({where:{id:"s1",userId:"mine",updatedAt},data:{projectId:"project",pinned:true,updatedAt}});
  });
  it("removes project membership without deleting the chat",async()=>{
    expect((await PATCH(patch({projectId:null}) as never,context)).status).toBe(200);
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});


describe("delete chat",()=>{
  beforeEach(()=>vi.clearAllMocks());
  it("deletes only the owned chat",async()=>{
    mocks.remove.mockResolvedValue({count:1});
    expect((await DELETE(patch({}) as never,context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith({where:{id:"s1",userId:"mine"}});
  });
  it("refuses another user's chat",async()=>{
    mocks.remove.mockResolvedValue({count:0});
    expect((await DELETE(patch({}) as never,context)).status).toBe(404);
  });
});
