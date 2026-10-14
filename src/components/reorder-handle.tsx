"use client";
import { GripVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReorderRequest } from "@/lib/list-order";

export function ReorderHandle({id,title,scope,ids,disabled,onMove}:{id:string;title:string;scope:string;ids:string[];disabled?:boolean;onMove:(move:ReorderRequest)=>Promise<unknown>}) {
  const drag=useRef<{x:number;y:number;active:boolean;row:HTMLElement;target?:HTMLElement;after:boolean}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  function clear() {
    const current=drag.current;
    current?.row.removeAttribute("data-order-dragging");
    current?.target?.removeAttribute("data-order-drop");
    drag.current=null;
  }
  useEffect(()=>()=>{drag.current?.row.removeAttribute("data-order-dragging");drag.current?.target?.removeAttribute("data-order-drop");},[]);
  async function move(request:ReorderRequest) {
    setBusy(true);setError("");
    try { if(!await onMove(request)) setError("Could not move the item. Try again."); }
    catch(error) {setError(error instanceof Error ? error.message : "Could not move the item. Try again.");}
    finally {setBusy(false);}
  }
  return <>
    <button type="button" aria-label={`Reorder ${title}`} title="Drag to reorder · Arrow keys move up/down" className="list-reorder-handle" disabled={busy || disabled}
      onPointerDown={event=>{
        if(event.button!==0) return;
        const row=event.currentTarget.closest<HTMLElement>("[data-order-id]");
        if(!row) return;
        event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);
        drag.current={x:event.clientX,y:event.clientY,active:false,row,after:false};
      }}
      onPointerMove={event=>{
        const current=drag.current;if(!current) return;
        if(!current.active && Math.hypot(event.clientX-current.x,event.clientY-current.y)<6) return;
        current.active=true;current.row.setAttribute("data-order-dragging","true");
        const container=current.row.closest("[data-reorder-list]");
        const target=document.elementsFromPoint(event.clientX,event.clientY).map(element=>element.closest<HTMLElement>("[data-order-id]")).find(element=>element && element.dataset.orderScope===scope && element.dataset.orderId!==id && element.closest("[data-reorder-list]")===container);
        current.target?.removeAttribute("data-order-drop");current.target=target ?? undefined;
        if(target){const rect=target.getBoundingClientRect();current.after=event.clientY>rect.y+rect.height/2;target.setAttribute("data-order-drop",current.after ? "after":"before");}
        // Scroll only the containing list while approaching its edges.
        let scroll=current.row.parentElement;
        while(scroll && scroll.scrollHeight<=scroll.clientHeight) scroll=scroll.parentElement;
        if(scroll){const rect=scroll.getBoundingClientRect();if(event.clientY<rect.top+30)scroll.scrollBy({top:-12});else if(event.clientY>rect.bottom-30)scroll.scrollBy({top:12});}
      }}
      onPointerUp={event=>{
        const current=drag.current;
        const targetId=current?.target?.dataset.orderId;
        const request=current?.active && targetId ? {id,targetId,after:current.after}:null;
        clear();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
        if(request)void move(request);
      }} onPointerCancel={clear} onLostPointerCapture={clear}
      onKeyDown={event=>{
        if(event.key!=="ArrowUp" && event.key!=="ArrowDown")return;
        event.preventDefault();const index=ids.indexOf(id), targetId=ids[index+(event.key==="ArrowUp"?-1:1)];
        if(targetId)void move({id,targetId,after:event.key==="ArrowDown"});
      }}><GripVertical size={13}/></button>
    {error && <span role="alert" className="list-reorder-error">{error}</span>}
  </>;
}
