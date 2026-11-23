// Chats と Notes の横断検索。API・サーバー側の検索・ダイアログが共有する型と、ブラウザでも使える純粋な関数だけを置く
// （prisma を読み込むモジュールをクライアントから import しないため、検索語の分割はここに置く）。
import { foldSearchText } from "@/lib/search-fold";
import type { PageKind } from "@/lib/page-kinds";

export const SEARCH_SCOPES = ["all", "chats", "notes"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export const MAX_SEARCH_QUERY_CHARS = 100;
export const MAX_SEARCH_TERMS = 8;
export const SEARCH_RESULT_LIMIT = 15;
// projectId（Chats の絞り込み）。cuid などの ID だけを受け付ける。
export const SEARCH_PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type NoteSearchResult = {
  kind: "note";
  id: string;
  // ページの種類（ノート・ホワイトボード・スライド）。kind は結果の区分（note / chat）なので別の名前にする。
  pageKind: PageKind;
  title: string;
  icon: string | null;
  snippet: string;
  // 一致した場所の ID：ノートはブロック、ホワイトボードは要素、スライドはページ。タイトルだけが一致した場合は null（先頭を開く）。
  blockId: string | null;
  updatedAt: string;
};

export type ChatSearchResult = {
  kind: "chat";
  id: string;
  title: string;
  icon: string | null;
  // 一致したメッセージ（またはその添付ファイル）の抜粋。タイトルだけが一致した場合は空文字。
  snippet: string;
  // 抜粋の元になったメッセージ。語は会話の複数のメッセージに散らばっていてもよく、その中で一致する語がいちばん多い（同数なら新しい）もの。
  messageId: string | null;
  role: "USER" | "ASSISTANT" | null;
  // 抜粋が添付ファイルの抽出本文から取られたときの、そのファイル名。メッセージ本文からのときは null。
  attachmentName: string | null;
  projectId: string | null;
  // 全部の語がタイトルに含まれる。
  titleMatch: boolean;
  updatedAt: string;
};

export type SearchResponse = { query: string; notes: NoteSearchResult[]; chats: ChatSearchResult[] };

// 表記ゆれ（全角・半角、ひらがな・カタカナ、大文字・小文字）をそろえ、空白（全角空白も）で分け、重複を除いて最大 8 語。
// 全部の語が一致したものだけを返す。LIKE のエスケープより前に畳み込むこと（全角の ％ が % になる）。
export function parseSearchTerms(query: string): string[] {
  return [...new Set(foldSearchText(query).split(/\s+/).filter(Boolean))].slice(0, MAX_SEARCH_TERMS);
}
