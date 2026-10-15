import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({find:vi.fn(),findOne:vi.fn(),count:vi.fn(),create:vi.fn(),update:vi.fn(),remove:vi.fn(),lock:vi.fn()}));
vi.mock("@/lib/auth",()=>({getOrCreateAnonymousUser:async()=>({id:"mine"})}));
vi.mock("@/lib/prisma",()=>{
  const chatProject={findMany:mocks.find,findFirst:mocks.findOne,count:mocks.count,create:mocks.create,updateMany:mocks.update,deleteMany:mocks.remove};
  return {prisma:{chatProject,$transaction:async(work:(tx:unknown)=>unknown)=>work({chatProject,$executeRaw:mocks.lock})}};
});
import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[projectId]/route";
const context={params:Promise.resolve({projectId:"p"})};
const request=(body:unknown)=>new Request("http://localhost/api/chat-projects",{method:"POST",body:JSON.stringify(body)});
describe("private chat projects",()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.count.mockResolvedValue(0);mocks.create.mockResolvedValue({id:"p",name:"Study"});mocks.update.mockResolvedValue({count:1});mocks.remove.mockResolvedValue({count:1});mocks.findOne.mockResolvedValue({id:"p",name:"Work",instructions:null,_count:{notes:0}});});
  it("lists only the current owner's projects",async()=>{
    mocks.find.mockResolvedValue([]);expect((await GET()).status).toBe(200);
    expect(mocks.find.mock.calls[0][0].where).toEqual({userId:"mine"});
  });
  it("lists how many live notes each project references and whether it has instructions",async()=>{
    mocks.find.mockResolvedValueOnce([{id:"a",name:"A",_count:{notes:2}},{id:"b",name:"B",_count:{notes:0}}]).mockResolvedValueOnce([{id:"a"}]);
    const response=await GET();
    expect(await response.json()).toEqual({projects:[{id:"a",name:"A",noteCount:2,hasInstructions:true},{id:"b",name:"B",noteCount:0,hasInstructions:false}]});
    // ゴミ箱のノートは数えず、指示の本文は一覧のために読み込まない。
    expect(mocks.find.mock.calls[0][0].select._count).toEqual({select:{notes:{where:{note:{deletedAt:null}}}}});
    expect(mocks.find.mock.calls[1][0]).toEqual({where:{userId:"mine",instructions:{not:null}},select:{id:true}});
  });
  it("creates a project for the current owner",async()=>{
    const response=await POST(request({name:" Study "}));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({project:{id:"p",name:"Study",noteCount:0,hasInstructions:false}});
    expect(mocks.create.mock.calls[0][0].data).toEqual({name:"Study",userId:"mine"});
    expect(mocks.lock).toHaveBeenCalledOnce();
  });
  it("enforces the project limit inside the locked transaction",async()=>{
    mocks.count.mockResolvedValue(50);expect((await POST(request({name:"Study"}))).status).toBe(400);expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["", "x".repeat(61)])("rejects invalid names",async name=>{expect((await POST(request({name}))).status).toBe(400);expect(mocks.create).not.toHaveBeenCalled();});
  it("renames only owned projects",async()=>{
    const response=await PATCH(request({name:"Work"}),context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({project:{id:"p",name:"Work",noteCount:0,hasInstructions:false}});
    expect(mocks.update).toHaveBeenCalledWith({where:{id:"p",userId:"mine"},data:{name:"Work"}});
    // 名前だけの変更では参照ノートに触らない（ロックも取らない）。
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("deletes the owned project rather than its conversations",async()=>{
    expect((await DELETE(request({}),context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith({where:{id:"p",userId:"mine"}});
  });
  it("returns 404 for another user's project",async()=>{
    mocks.remove.mockResolvedValue({count:0});expect((await DELETE(request({}),context)).status).toBe(404);
  });
});
