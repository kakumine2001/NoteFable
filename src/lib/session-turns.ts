// 同じ会話は、ノートの AI パネルと Chats の両方から続けられる。片方で回答を待っている間にもう片方から送ると、
// 後の発言が先の回答の「下」に保存され、先の回答が保存されたときに表示から外れてしまう。
// そこで、いま回答を待っている会話の ID を、同じページの中で両方から見えるようにしておく（タブをまたいだ調整はしない）。
export const notePanelTurns = new Set<string>();
export const chatsTurns = new Set<string>();
