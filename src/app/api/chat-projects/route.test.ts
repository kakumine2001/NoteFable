import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({find:vi.fn(),count:vi.fn(),create:vi.fn(),update:vi.fn(),remove:vi.fn(),lock:vi.fn()}));
vi.mock("@/lib/auth",()=>({getOrCreateAnonymousUser:async()=>({id:"mine"})}));
vi.mock("@/lib/prisma",()=>{
  const chatProject={findMany:mocks.find,count:mocks.count,create:mocks.create,updateMany:mocks.update,deleteMany:mocks.remove};
  return {prisma:{chatProject,$transaction:async(work:(tx:unknown)=>unknown)=>work({chatProject,$executeRaw:mocks.lock})}};
});
import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[projectId]/route";
const context={params:Promise.resolve({projectId:"p"})};
const request=(body:unknown)=>new Request("http://localhost/api/chat-projects",{method:"POST",body:JSON.stringify(body)});
describe("private chat projects",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.count.mockResolvedValue(0);mocks.create.mockResolvedValue({id:"p",name:"Study"});mocks.update.mockResolvedValue({count:1});mocks.remove.mockResolvedValue({count:1});});
  it("lists only the current owner's projects",async()=>{
    mocks.find.mockResolvedValue([]);expect((await GET()).status).toBe(200);
    expect(mocks.find.mock.calls[0][0].where).toEqual({userId:"mine"});
  });
  it("creates a project for the current owner",async()=>{
    expect((await POST(request({name:" Study "}))).status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data).toEqual({name:"Study",userId:"mine"});
    expect(mocks.lock).toHaveBeenCalledOnce();
  });
  it("enforces the project limit inside the locked transaction",async()=>{
    mocks.count.mockResolvedValue(50);expect((await POST(request({name:"Study"}))).status).toBe(400);expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["", "x".repeat(61)])("rejects invalid names",async name=>{expect((await POST(request({name}))).status).toBe(400);expect(mocks.create).not.toHaveBeenCalled();});
  it("renames only owned projects",async()=>{
    expect((await PATCH(request({name:"Work"}),context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({where:{id:"p",userId:"mine"},data:{name:"Work"}});
  });
  it("deletes the owned project rather than its conversations",async()=>{
    expect((await DELETE(request({}),context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith({where:{id:"p",userId:"mine"}});
  });
  it("returns 404 for another user's project",async()=>{
    mocks.remove.mockResolvedValue({count:0});expect((await DELETE(request({}),context)).status).toBe(404);
  });
});
