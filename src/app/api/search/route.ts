import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { parseSearchTerms, searchChats, searchNotes } from "@/lib/search";
import { MAX_SEARCH_QUERY_CHARS, SEARCH_PROJECT_ID_PATTERN, SEARCH_SCOPES, type SearchScope } from "@/types/search";
import { msg, fmt } from "@/lib/i18n/translate";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  // Chats と Notes をまとめて探す。q の全語を含むものだけを、利用者本人の分から返す。
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  if (!query || query.length > MAX_SEARCH_QUERY_CHARS) {
    return NextResponse.json({ error: fmt("Enter 1 to {max} characters to search for.", { max: MAX_SEARCH_QUERY_CHARS }) }, { status: 400, headers });
  }
  const scope = params.get("scope") ?? "all";
  if (!SEARCH_SCOPES.includes(scope as SearchScope)) {
    return NextResponse.json({ error: fmt("Scope must be one of: {scopes}.", { scopes: SEARCH_SCOPES.join(", ") }) }, { status: 400, headers });
  }
  // projectId は Chats だけの絞り込み（Notes には効かない）。空は「絞り込まない」。利用者本人のものでない ID は、会話が 1 件も当たらないだけ。
  const projectId = (params.get("projectId") ?? "").trim() || null;
  if (projectId && !SEARCH_PROJECT_ID_PATTERN.test(projectId)) {
    return NextResponse.json({ error: msg("Project id is not valid.") }, { status: 400, headers });
  }

  try {
    const user = await getOrCreateUser();
    const terms = parseSearchTerms(query);
    const [notes, chats] = await Promise.all([
      scope === "chats" ? [] : searchNotes(user.id, terms, { rawQuery: query, signal: request.signal }),
      scope === "notes" ? [] : searchChats(user.id, terms, { projectId }),
    ]);
    return NextResponse.json({ query, notes, chats }, { headers });
  } catch (error) {
    console.error("Failed to search", error);
    return NextResponse.json({ error: msg("Database is unavailable."), notes: [], chats: [] }, { status: 503, headers });
  }
}
