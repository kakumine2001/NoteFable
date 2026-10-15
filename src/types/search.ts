// Chats と Notes の横断検索。API・サーバー側の検索・ダイアログが共有する型と、ブラウザでも使える純粋な関数だけを置く
// （prisma を読み込むモジュールをクライアントから import しないため、検索語の分割はここに置く）。

export const SEARCH_SCOPES = ["all", "chats", "notes"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export const MAX_SEARCH_QUERY_CHARS = 100;
export const MAX_SEARCH_TERMS = 8;
export const SEARCH_RESULT_LIMIT = 15;

export type NoteSearchResult = {
  kind: "note";
  id: string;
  title: string;
  icon: string | null;
  snippet: string;
  // 一致したブロックの ID。タイトルだけが一致した場合は null（ノートの先頭を開く）。
  blockId: string | null;
  updatedAt: string;
};

export type ChatSearchResult = {
  kind: "chat";
  id: string;
  title: string;
  icon: string | null;
  // 一致したメッセージの抜粋。タイトルだけが一致した場合は空文字。
  snippet: string;
  messageId: string | null;
  role: "USER" | "ASSISTANT" | null;
  projectId: string | null;
  titleMatch: boolean;
  updatedAt: string;
};

export type SearchResponse = { query: string; notes: NoteSearchResult[]; chats: ChatSearchResult[] };

// 空白で分け、小文字にそろえ、重複を除いて最大 8 語。すべての語が一致した結果だけを返す。
export function parseSearchTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, MAX_SEARCH_TERMS);
}
