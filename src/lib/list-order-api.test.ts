import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({find:vi.fn(),sql:vi.fn()}));
vi.mock("@/lib/auth",()=>({getOrCreateUser:async()=>({id:"mine"})}));
vi.mock("@/lib/prisma",()=>({databaseSchema:"public",prisma:{$transaction:async(work:(tx:unknown)=>unknown)=>work({session:{findMany:mocks.find},notePage:{findMany:mocks.find},$executeRaw:mocks.sql})}}));
import {reorderList} from "./list-order-api";
const req=(body:unknown)=>new Request("http://localhost/reorder",{method:"POST",body:JSON.stringify(body)});
describe("owned list reordering",()=>{
  beforeEach(()=>{vi.clearAllMocks();});
  it("refuses another user's row without writing order",async()=>{
    mocks.find.mockResolvedValue([{id:"a",position:1,groupId:null}]);
    expect((await reorderList(req({id:"foreign",targetId:"a",after:false}),"note")).status).toBe(404);
    expect(mocks.sql).toHaveBeenCalledTimes(1); // Only the advisory lock, no update.
    expect(mocks.find.mock.calls[0][0].where).toEqual({userId:"mine",deletedAt:null}); // ゴミ箱のノートは並べ替えの対象にしない。
  });
  it("pinning by drag retains project membership and keeps every owned row",async()=>{
    mocks.find.mockResolvedValue([{id:"a",position:1,pinned:false,projectId:null},{id:"b",position:2,pinned:true,projectId:"p"}]);
    const response=await reorderList(req({id:"a",targetId:"b",after:true}),"chat");
    expect(response.status).toBe(200);
    expect((await response.json()).items).toEqual([{id:"b",position:1},{id:"a",position:2,pinned:true,projectId:null}]);
    expect(mocks.find.mock.calls[0][0].where).toEqual({userId:"mine"});
  });
  it("reordering pinned chats from different projects does not change their project",async()=>{
    mocks.find.mockResolvedValue([{id:"a",position:1,pinned:true,projectId:"original"},{id:"b",position:2,pinned:true,projectId:"other"}]);
    const response=await reorderList(req({id:"a",targetId:"b",after:true}),"chat");
    expect((await response.json()).items[1]).toEqual({id:"a",position:2,pinned:true,projectId:"original"});
  });
  it("rejects malformed input before touching database",async()=>{
    expect((await reorderList(req({id:"a",targetId:"b",after:"yes"}),"chat")).status).toBe(400);expect(mocks.find).not.toHaveBeenCalled();
  });
});
