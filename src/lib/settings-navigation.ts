// 設定画面（settings-dialog.tsx）で「閉じる・戻る」を押したときに何をするかの決まり。画面から切り離して、テストで確かめる。
// スマホ幅の設定は 2 段（入口の一覧 → 欄の画面）。デスクトップ幅はいつも欄を出しているので onPage は false。
// Android（SettingsDialog.kt）と iOS（SettingsDialogModel）も同じ決まり。

export type SettingsTab = "general" | "personalization" | "plan" | "account";

export type SettingsStep =
  // 何もしない（保存・削除の最中）。
  | { type: "stay" }
  // その欄を出して、設定は閉じない。attention は「未保存の変更」のバーを揺らして知らせるとき。
  | { type: "show"; tab: SettingsTab; attention: boolean }
  // スマホ幅: 欄の画面から入口の一覧に戻る。
  | { type: "home" }
  // 設定を閉じる。
  | { type: "close" };

// Esc・端末の「戻る」・外側のクリック。1 段ずつ戻る:
// 開いている写真・絵文字の編集を閉じる（editorIn はその編集があった欄。閉じるのは呼ぶ側）→ 欄の画面なら一覧へ → 設定を閉じる。
// 未保存のカスタム指示があるときは、一覧にも戻らず閉じもしない（黙って捨てない）。
export function settingsDismissStep(state: { locked: boolean; editorIn: SettingsTab | null; onPage: boolean; dirty: boolean }): SettingsStep {
  if (state.locked) return { type: "stay" };
  if (state.editorIn) return { type: "show", tab: state.editorIn, attention: false };
  if (state.dirty) return { type: "show", tab: "personalization", attention: true };
  return { type: state.onPage ? "home" : "close" };
}

// 上の帯のボタン（一覧・デスクトップ幅の「閉じる」、欄の画面の「戻る」）。開いている編集ごと 1 回で閉じる。
// 切り抜き中・送信中の写真があるときは、その欄を出して閉じない。
export function settingsButtonStep(state: { locked: boolean; photoBusy: boolean; onPage: boolean; dirty: boolean }): SettingsStep {
  if (state.locked) return { type: "stay" };
  if (state.photoBusy) return { type: "show", tab: "account", attention: false };
  if (state.dirty) return { type: "show", tab: "personalization", attention: true };
  return { type: state.onPage ? "home" : "close" };
}
