import type { Session } from "@/types/chat";
type Changes = Partial<Pick<Session, "title" | "pinned" | "projectId" | "position">>;
// A refresh started before a confirmed edit must not restore old metadata or deleted rows.
export class SessionOrganizationSync {
  private sequence=0;
  private edits=new Map<string, Map<keyof Changes, {value: unknown; sequence: number}>>();
  private deleted=new Map<string,number>();
  mark() { return this.sequence; }
  saved(id: string, changes: Changes) {
    const sequence=++this.sequence;
    const fields=this.edits.get(id) ?? new Map();
    for (const key of Object.keys(changes) as (keyof Changes)[]) fields.set(key,{value:changes[key],sequence});
    this.edits.set(id,fields);
  }
  removed(id: string) { this.deleted.set(id,++this.sequence); }
  reconcile(sessions: Session[], started: number) {
    return sessions.filter(session=>(this.deleted.get(session.id) ?? -1)<=started).map(session=>{
      const next={...session};
      for(const [key,edit] of this.edits.get(session.id) ?? []) if(edit.sequence>started) Object.assign(next,{[key]:edit.value});
      return next;
    });
  }
}

// チャットプロジェクトの一覧に載せる情報。件数と指示の有無は、サーバーが返したものを丸ごと保持する。
type Project = { id: string; name: string; noteCount?: number; hasInstructions?: boolean };
export class ChatProjectSync {
  private sequence=0;
  private edits=new Map<string,{project: Project | null; sequence: number}>();
  mark() { return this.sequence; }
  saved(project: Project) { this.edits.set(project.id,{project,sequence:++this.sequence}); }
  removed(id: string) { this.edits.set(id,{project:null,sequence:++this.sequence}); }
  reconcile(projects: Project[], started: number) {
    const result=new Map(projects.map(project=>[project.id,project]));
    for(const [id,edit] of this.edits) if(edit.sequence>started) {
      if(edit.project) result.set(id,edit.project); else result.delete(id);
    }
    return [...result.values()];
  }
}
