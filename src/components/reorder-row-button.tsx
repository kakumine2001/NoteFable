"use client";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import type { ReorderRequest } from "@/lib/list-order";
import { canDropIn } from "@/lib/workspace-sections";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";

// 行の本体ボタン（開く）がそのままドラッグ元。マウスは 6px 動いたらドラッグ、触屏は長押し、Alt+↑/↓ で並べ替え。
// 移動中（busy）はドラッグとキー操作だけ止め、ボタン自体は無効にしない（フォーカスとクリックで開く操作を残す）。
export function ReorderRowButton({id,title,scope,ids,disabled,onMove,children,className,onOpen,onMoveProject,onMoveGroup,onPrefetch,onCancelPrefetch}:{id:string;title:string;scope:string;ids:string[];disabled?:boolean;onMove:(move:ReorderRequest)=>Promise<unknown>;children:ReactNode;className:string;onOpen:()=>void;onMoveProject?:(projectId:string|null)=>Promise<unknown>;onMoveGroup?:(groupId:string|null)=>Promise<unknown>;onPrefetch?:(immediate?:boolean)=>void;onCancelPrefetch?:()=>void}) {
  const t = useT();
  const dropAttribute=onMoveProject ? "data-chat-project-drop" : onMoveGroup ? "data-note-group-drop" : null;
  const onMoveContainer=onMoveProject ?? onMoveGroup;
  const drag=useRef<{x:number;y:number;active:boolean;row:HTMLElement;target?:HTMLElement;after:boolean}|null>(null);
  const suppressClick=useRef(false);
  const buttonRef=useRef<HTMLButtonElement>(null);
  const touchTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  function clear() {
    if(touchTimer.current!==null){clearTimeout(touchTimer.current);touchTimer.current=null;}
    const current=drag.current;
    current?.row.removeAttribute("data-order-dragging");
    current?.target?.removeAttribute("data-order-drop");
    drag.current=null;
  }
  function updateTarget(x:number,y:number) {
    const current=drag.current;if(!current)return;
    current.row.setAttribute("data-order-dragging","true");
    const container=current.row.closest("[data-reorder-list]");
    // data-drop-kind のある放し先（ワークスペースの分区の見出しと分区の最上位の行）は、同じ分区のページ（行の data-page-kind）だけを受ける。
    const dragKind=current.row.dataset.pageKind;
    const target=document.elementsFromPoint(x,y).map(element=>element.closest<HTMLElement>(dropAttribute ? `[data-order-id], [${dropAttribute}]` : "[data-order-id]")).find(element=>element && element.closest("[data-reorder-list]")===container && ((dropAttribute && element.hasAttribute(dropAttribute)) || (element.dataset.orderScope===scope && element.dataset.orderId!==id)) && canDropIn(dragKind,element.dataset.dropKind));
    current.target?.removeAttribute("data-order-drop");current.target=target ?? undefined;
    if(target){const rect=target.getBoundingClientRect();current.after=y>rect.y+rect.height/2;target.setAttribute("data-order-drop",dropAttribute && target.hasAttribute(dropAttribute) ? "into" : current.after ? "after":"before");}
    let scroll=current.row.parentElement;
    while(scroll && scroll.scrollHeight<=scroll.clientHeight)scroll=scroll.parentElement;
    if(scroll){const rect=scroll.getBoundingClientRect();if(y<rect.top+30)scroll.scrollBy({top:-12});else if(y>rect.bottom-30)scroll.scrollBy({top:12});}
  }
  function finish() {
    const current=drag.current;
    const target=current?.target;
    const active=current?.active;
    const after=current?.after ?? false;
    suppressClick.current=!!active;if(active)setTimeout(()=>{suppressClick.current=false;},0);
    clear();
    if(!active || !target)return;
    if(dropAttribute && target.hasAttribute(dropAttribute) && onMoveContainer) {
      setBusy(true);setError("");
      void Promise.resolve().then(()=>onMoveContainer(target.getAttribute(dropAttribute) || null)).then(ok=>{if(!ok)setError(msg("Could not move the item. Try again."));}).catch(error=>setError(error instanceof Error ? error.message : msg("Could not move the item. Try again."))).finally(()=>setBusy(false));
    } else if(target.dataset.orderId)void move({id,targetId:target.dataset.orderId,after});
  }
  useEffect(()=>()=>{drag.current?.row.removeAttribute("data-order-dragging");drag.current?.target?.removeAttribute("data-order-drop");},[]);
  async function move(request:ReorderRequest) {
    setBusy(true);setError("");
    try { if(!await onMove(request)) setError(msg("Could not move the item. Try again.")); }
    catch(error) {setError(error instanceof Error ? error.message : msg("Could not move the item. Try again."));}
    finally {setBusy(false);}
  }
  // A long press starts touch dragging; ordinary swipes still scroll the list.
  const touchGesture=useEffectEvent((kind:"start"|"move"|"end"|"cancel",event?:TouchEvent)=>{
    const button=buttonRef.current;if(!button)return;
    if(kind==="start" && event){
      if(busy || disabled || event.touches.length!==1)return;
      const row=button.closest<HTMLElement>("[data-order-id]");if(!row)return;
      const touch=event.touches[0];suppressClick.current=false;
      drag.current={x:touch.clientX,y:touch.clientY,active:false,row,after:false};
      touchTimer.current=setTimeout(()=>{if(drag.current){drag.current.active=true;updateTarget(drag.current.x,drag.current.y);}},350);
    } else if(kind==="move" && event){
      const current=drag.current;if(!current)return;
      if(event.touches.length!==1){clear();return;}
      const touch=event.touches[0];
      if(!current.active){if(Math.hypot(touch.clientX-current.x,touch.clientY-current.y)>8)clear();return;}
      event.preventDefault();updateTarget(touch.clientX,touch.clientY);
    } else if(kind==="end"){if(drag.current?.active)event?.preventDefault();finish();}
    else clear();
  });
  useEffect(()=>{
    const button=buttonRef.current;if(!button)return;
    const start=(event:TouchEvent)=>touchGesture("start",event);
    const moving=(event:TouchEvent)=>touchGesture("move",event);
    const end=(event:TouchEvent)=>touchGesture("end",event);
    const cancel=()=>touchGesture("cancel");
    button.addEventListener("touchstart",start,{passive:true});button.addEventListener("touchmove",moving,{passive:false});button.addEventListener("touchend",end);button.addEventListener("touchcancel",cancel);
    return ()=>{cancel();button.removeEventListener("touchstart",start);button.removeEventListener("touchmove",moving);button.removeEventListener("touchend",end);button.removeEventListener("touchcancel",cancel);};
  },[]);
  return <>
    <button ref={buttonRef} type="button" title={title} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" className={`row-drag ${className}`} disabled={disabled}
      onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}onOpen();}}
      onPointerEnter={event=>{if(event.pointerType!=="touch")onPrefetch?.(false);}}
      onPointerLeave={()=>{onCancelPrefetch?.();}}
      onFocus={()=>{onPrefetch?.(true);}}
      onContextMenu={event=>{if(drag.current)event.preventDefault();}}
      onPointerDown={event=>{
        if(event.pointerType==="touch")return;
        if(event.button!==0 || busy) return;
        onPrefetch?.(true);
        const row=event.currentTarget.closest<HTMLElement>("[data-order-id]");
        if(!row) return;
        suppressClick.current=false;event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);
        drag.current={x:event.clientX,y:event.clientY,active:false,row,after:false};
      }}
      onPointerMove={event=>{
        const current=drag.current;if(!current) return;
        if(event.pointerType==="touch")return;
        if(!current.active && Math.hypot(event.clientX-current.x,event.clientY-current.y)<6) return;
        current.active=true;updateTarget(event.clientX,event.clientY);
      }}
      onPointerUp={event=>{
        if(event.pointerType==="touch")return;
        finish();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={event=>{if(event.pointerType!=="touch")clear();}} onLostPointerCapture={event=>{if(event.pointerType!=="touch")clear();}}
      onKeyDown={event=>{
        if(busy || !event.altKey || (event.key!=="ArrowUp" && event.key!=="ArrowDown"))return;
        event.preventDefault();const index=ids.indexOf(id), targetId=ids[index+(event.key==="ArrowUp"?-1:1)];
        if(targetId)void move({id,targetId,after:event.key==="ArrowDown"});
      }}>{children}</button>
    {error && <span role="alert" className="list-reorder-error">{t(error)}</span>}
  </>;
}
