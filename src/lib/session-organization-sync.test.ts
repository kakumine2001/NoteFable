import { describe, expect, it } from "vitest";
import { ChatProjectSync, SessionOrganizationSync } from "./session-organization-sync";
const row={id:"s",title:"Old",pinned:false,projectId:null,createdAt:"",updatedAt:""};
describe("refreshing chat organization",()=>{
  it("retains edits confirmed while an old refresh was running",()=>{
    const sync=new SessionOrganizationSync();const mark=sync.mark();sync.saved("s",{title:"Renamed",pinned:true});
    expect(sync.reconcile([row],mark)[0]).toMatchObject({title:"Renamed",pinned:true});
  });
  it("accepts later remote values without permanently masking them",()=>{
    const sync=new SessionOrganizationSync();sync.saved("s",{title:"Renamed"});
    expect(sync.reconcile([{...row,title:"Remote"}],sync.mark())[0].title).toBe("Remote");
  });
  it("does not resurrect a conversation deleted during refresh",()=>{
    const sync=new SessionOrganizationSync();const mark=sync.mark();sync.removed("s");expect(sync.reconcile([row],mark)).toEqual([]);
  });
  it("applies only fields that changed after this refresh started",()=>{
    const sync=new SessionOrganizationSync();sync.saved("s",{title:"Earlier"});const mark=sync.mark();sync.saved("s",{pinned:true});
    expect(sync.reconcile([{...row,title:"Remote"}],mark)[0]).toMatchObject({title:"Remote",pinned:true});
  });
});
describe("refreshing projects",()=>{
  it("keeps the reference note count and instructions flag that the server returned",()=>{
    const sync=new ChatProjectSync();const mark=sync.mark();sync.saved({id:"a",name:"Mail",noteCount:2,hasInstructions:true});
    expect(sync.reconcile([{id:"a",name:"Mail",noteCount:0,hasInstructions:false}],mark)).toEqual([{id:"a",name:"Mail",noteCount:2,hasInstructions:true}]);
  });
  it("merges newly created projects while retaining existing ones",()=>{
    const sync=new ChatProjectSync();const mark=sync.mark();sync.saved({id:"new",name:"New"});
    expect(sync.reconcile([{id:"old",name:"Old"}],mark)).toEqual([{id:"old",name:"Old"},{id:"new",name:"New"}]);
  });
  it("does not undo renames or restore a deleted project",()=>{
    const sync=new ChatProjectSync();const mark=sync.mark();sync.saved({id:"a",name:"Renamed"});sync.removed("b");
    expect(sync.reconcile([{id:"a",name:"Old"},{id:"b",name:"Deleted"}],mark)).toEqual([{id:"a",name:"Renamed"}]);
  });
});
