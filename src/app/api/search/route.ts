import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { parseSearchTerms, searchChats, searchNotes } from "@/lib/search";
import { MAX_SEARCH_QUERY_CHARS, SEARCH_SCOPES, type SearchScope } from "@/types/search";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  // Chats と Notes をまとめて探す。q の全語を含むものだけを、利用者本人の分から返す。
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  if (!query || query.length > MAX_SEARCH_QUERY_CHARS) {
    return NextResponse.json({ error: `Enter 1 to ${MAX_SEARCH_QUERY_CHARS} characters to search for.` }, { status: 400, headers });
  }
  const scope = params.get("scope") ?? "all";
  if (!SEARCH_SCOPES.includes(scope as SearchScope)) {
    return NextResponse.json({ error: `Scope must be one of: ${SEARCH_SCOPES.join(", ")}.` }, { status: 400, headers });
  }

  try {
    const user = await getOrCreateAnonymousUser();
    const terms = parseSearchTerms(query);
    const [notes, chats] = await Promise.all([
      scope === "chats" ? [] : searchNotes(user.id, terms),
      scope === "notes" ? [] : searchChats(user.id, terms),
    ]);
    return NextResponse.json({ query, notes, chats }, { headers });
  } catch (error) {
    console.error("Failed to search", error);
    return NextResponse.json({ error: "Database is unavailable.", notes: [], chats: [] }, { status: 503, headers });
  }
}
