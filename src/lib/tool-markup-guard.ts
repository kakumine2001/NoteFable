import { msg } from "@/lib/i18n/translate";
// 上流がツール呼び出しを本文として返した場合、表示・保存前に止める。
const TOOL_MARKERS = [
  ...["｜", "｜｜", "|", "||"].flatMap((bar) => [
    `<${bar}DSML${bar}`,
    `</${bar}DSML${bar}`,
  ]),
  "<tool_result>",
  "</tool_result>",
];

export function hasToolMarkup(text: string) {
  return TOOL_MARKERS.some((marker) => text.includes(marker));
}

export class ToolMarkupGuard {
  private pending = "";

  push(delta: string) {
    this.pending += delta;
    if (hasToolMarkup(this.pending)) {
      throw new Error(
        msg("AI returned an invalid tool response. Please retry, or use GPT for web search."),
      );
    }

    // マーカーの途中で分割された末尾だけを保留し、通常の Markdown はそのまま流す。
    let keep = 0;
    for (const marker of TOOL_MARKERS) {
      for (let size = 1; size < marker.length; size += 1) {
        if (this.pending.endsWith(marker.slice(0, size))) keep = Math.max(keep, size);
      }
    }
    const ready = this.pending.slice(0, this.pending.length - keep);
    this.pending = this.pending.slice(this.pending.length - keep);
    return ready;
  }

  finish() {
    const tail = this.pending;
    this.pending = "";
    // 単独の < や </ は通常の文章でも使う。
    if (tail.length > 2) {
      throw new Error(msg("AI returned an incomplete tool response. Please retry."));
    }
    return tail;
  }
}
