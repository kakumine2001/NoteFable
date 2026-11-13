import { msg } from "@/lib/i18n/translate";
export type ReorderRequest = { id: string; targetId: string; after: boolean };
export function reorderedIds(ids: string[], move: ReorderRequest) {
  if (!ids.includes(move.id) || !ids.includes(move.targetId)) throw new Error(msg("Item not found."));
  if (move.id===move.targetId) return ids;
  const result=ids.filter(id=>id!==move.id);
  result.splice(result.indexOf(move.targetId)+(move.after ? 1 : 0),0,move.id);
  return result;
}
export class OrderRefreshSync {
  private sequence=0;
  private edits=new Map<string,{position:{value:number;sequence:number};group?:{value:string|null;sequence:number}}>();
  mark(){return this.sequence;}
  saved(items:Array<{id:string;position:number;groupId?:string|null}>){
    const sequence=++this.sequence;
    for(const item of items)this.edits.set(item.id,{
      position:{value:item.position,sequence},
      group:item.groupId!==undefined ? {value:item.groupId,sequence} : this.edits.get(item.id)?.group,
    });
  }
  reconcile<T extends {id:string;position?:number;groupId:string|null}>(items:T[],started:number):T[]{
    return items.map(item=>{
      const edit=this.edits.get(item.id);if(!edit)return item;
      return {...item,...(edit.position.sequence>started ? {position:edit.position.value}:{}),...(edit.group && edit.group.sequence>started ? {groupId:edit.group.value}: {})};
    });
  }
}
export function byPosition<T extends {position?:number;createdAt:string;id:string}>(a:T,b:T) {
  return (a.position ?? 0)-(b.position ?? 0) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}
