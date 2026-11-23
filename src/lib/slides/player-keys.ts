// 放映中のキー操作（PowerPoint・Google スライドと同じ）。純粋な関数（テストあり）。
//   次へ: → ↓ スペース PageDown Enter N   前へ: ← ↑ PageUp Backspace P   最初・最後: Home End
//   数字 + Enter: その番号の枚へ   B / . : 黒い画面   W / , : 白い画面   Esc: 終わる（数字を打っている途中なら数字を消す）
export type PlayerAction =
  | { type: "next" } | { type: "previous" } | { type: "first" } | { type: "last" }
  | { type: "blank"; color: "black" | "white" }
  | { type: "digit"; digit: string } | { type: "jump" } | { type: "clearDigits" }
  | { type: "exit" };

export function playerAction(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">, typingNumber: boolean): PlayerAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key;
  if (/^[0-9]$/.test(key)) return { type: "digit", digit: key };
  if (key === "Enter" && typingNumber) return { type: "jump" };
  if (key === "Escape") return typingNumber ? { type: "clearDigits" } : { type: "exit" };
  switch (key) {
    case "ArrowRight": case "ArrowDown": case " ": case "Spacebar": case "PageDown": case "Enter": case "n": case "N": return { type: "next" };
    case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace": case "p": case "P": return { type: "previous" };
    case "Home": return { type: "first" };
    case "End": return { type: "last" };
    case "b": case "B": case ".": return { type: "blank", color: "black" };
    case "w": case "W": case ",": return { type: "blank", color: "white" };
    default: return null;
  }
}
