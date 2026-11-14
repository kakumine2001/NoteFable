import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getOrCreateUser } from "@/lib/auth";
import { databaseSchema, prisma } from "@/lib/prisma";
import { readSmallJson } from "@/lib/note-groups";
import { NoteValidationError } from "@/lib/note-document";
import { reorderedIds } from "@/lib/list-order";
import { msg } from "@/lib/i18n/translate";

export async function reorderList(request: Request, kind: "chat" | "note") {
  try {
    const body=await readSmallJson(request);
    if(typeof body.id!=="string" || typeof body.targetId!=="string" || body.id.length>100 || body.targetId.length>100 || typeof body.after!=="boolean") throw new NoteValidationError(msg("Invalid move."));
    const user=await getOrCreateUser();
    const move={id:body.id,targetId:body.targetId,after:body.after};
    const items=await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${kind}-order:${user.id}`}))`;
      const rows=kind==="chat"
        ? await tx.session.findMany({where:{userId:user.id,noteId:null},orderBy:[{position:"asc"},{updatedAt:"desc"},{id:"desc"}],select:{id:true,position:true,projectId:true,pinned:true}})
        : await tx.notePage.findMany({where:{userId:user.id,deletedAt:null},orderBy:[{position:"asc"},{createdAt:"desc"},{id:"desc"}],select:{id:true,position:true,groupId:true}});
      const source=rows.find(row=>row.id===move.id), target=rows.find(row=>row.id===move.targetId);
      if(!source || !target) throw new NoteValidationError(msg("Item not found."),404);
      const ids=reorderedIds(rows.map(row=>row.id),move);
      const table=Prisma.raw(`"${databaseSchema}"."${kind==="chat" ? "Session" : "NotePage"}"`);
      // Raw metadata-only writes avoid changing @updatedAt or note versions during autosave.
      await tx.$executeRaw(Prisma.sql`UPDATE ${table} AS t SET "position" = ordering.pos FROM unnest(${ids}::text[]) WITH ORDINALITY AS ordering(id,pos) WHERE t."id" = ordering.id AND t."userId" = ${user.id}`);
      const targetProjectId="projectId" in target ? (target.pinned && "projectId" in source ? source.projectId : target.projectId) : null;
      if(kind==="chat" && "projectId" in target) {
        await tx.$executeRaw(Prisma.sql`UPDATE ${table} SET "projectId" = ${targetProjectId}, "pinned" = ${target.pinned} WHERE "id" = ${source.id} AND "userId" = ${user.id}`);
      } else if("groupId" in target) {
        await tx.$executeRaw(Prisma.sql`UPDATE ${table} SET "groupId" = ${target.groupId} WHERE "id" = ${source.id} AND "userId" = ${user.id}`);
      }
      return ids.map((id,index)=>({id,position:index+1,...(id===source.id ? ("projectId" in target ? {projectId:targetProjectId,pinned:target.pinned} : {groupId:target.groupId}) : {})}));
    });
    return NextResponse.json({items});
  } catch(error) {
    if(error instanceof NoteValidationError) return NextResponse.json({error:error.message},{status:error.status});
    console.error("Could not reorder list",error);
    return NextResponse.json({error:msg("Could not move the item. Please try again.")},{status:503});
  }
}
