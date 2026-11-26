// プロジェクト設定画面（chat-project-settings.tsx）の、保存する変更と閉じ方の決まり。

type Baseline = { instructions: string | null; notes: { id: string }[] };
export type ProjectSettingsChanges = { instructions?: string; noteIds?: string[] };

// 読み込んだ時点から変えた項目だけを返す。参照ノートは全置き換えなので、並びも含めて同じなら送らない。
export function projectSettingsChanges(initial: Baseline, instructions: string, noteIds: string[]): ProjectSettingsChanges {
  const changes: ProjectSettingsChanges = {};
  const text = instructions.trim();
  if (text !== (initial.instructions ?? "")) changes.instructions = text;
  if (noteIds.join("\n") !== initial.notes.map((note) => note.id).join("\n")) changes.noteIds = noteIds;
  return changes;
}

// Esc・戻る・外側のクリック・「キャンセル」で閉じようとしたときにすること。
// 保存中は閉じない（失敗を知らせる場所がなくなる）。未保存の変更があれば黙って捨てず、「未保存の変更」の確認を出す。
export function projectSettingsDismissStep({ busy, dirty }: { busy: boolean; dirty: boolean }): "stay" | "confirm" | "close" {
  if (busy) return "stay";
  return dirty ? "confirm" : "close";
}

// 「未保存の変更」の確認を出した回数。変更を元に戻したら 0 に戻す（次に書き換えたときに、閉じようとしていないのに確認が出ないように）。
export function projectSettingsAttention(attention: number, dirty: boolean): number {
  return dirty ? attention : 0;
}
