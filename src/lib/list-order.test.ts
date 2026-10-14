import {describe,expect,it} from "vitest";
import {byPosition,OrderRefreshSync,reorderedIds} from "./list-order";
describe("manual ordering",()=>{
  it("moves up and down without losing or duplicating rows",()=>{
    expect(reorderedIds(["a","b","c"],{id:"c",targetId:"a",after:false})).toEqual(["c","a","b"]);
    expect(reorderedIds(["a","b","c"],{id:"a",targetId:"c",after:true})).toEqual(["b","c","a"]);
  });
  it("does not accept missing rows",()=>expect(()=>reorderedIds(["a"],{id:"foreign",targetId:"a",after:true})).toThrow());
  it("sorts by manual position even when a note was edited more recently",()=>{
    const rows=[{id:"b",position:2,createdAt:"2030"},{id:"a",position:1,createdAt:"2020"}];expect(rows.sort(byPosition).map(row=>row.id)).toEqual(["a","b"]);
  });
  it("retains a group move even after another position-only move",()=>{
    const sync=new OrderRefreshSync(),mark=sync.mark();sync.saved([{id:"a",position:5,groupId:"new"}]);sync.saved([{id:"a",position:6}]);
    expect(sync.reconcile([{id:"a",position:1,groupId:null}],mark)[0]).toEqual({id:"a",position:6,groupId:"new"});
  });
  it("retains a saved move against an older notes-list response",()=>{
    const sync=new OrderRefreshSync(),mark=sync.mark();sync.saved([{id:"a",position:5,groupId:"new"}]);
    expect(sync.reconcile([{id:"a",position:1,groupId:null}],mark)).toEqual([{id:"a",position:5,groupId:"new"}]);
  });
});
