export type WebSearchMode = "off" | "auto" | "force";

export function normalizeWebSearchMode(
  value: FormDataEntryValue | null,
  supported: boolean,
): WebSearchMode {
  if (!supported) return "off";

  const mode = String(value ?? "").toLowerCase();
  if (mode === "auto") return "auto";
  if (mode === "force" || mode === "true") return "force";
  if (mode === "off") return "off";
  // 未指定や未知の値は、検索対応モデルなら自動検索をデフォルトにする。
  // フロントエンドから mode を送らなくても検索が有効になるようにする。
  return "auto";
}

export function getDeepSeekWebSearchOptions(mode: WebSearchMode) {
  if (mode === "off") return {} as const;

  return {
    tools: [{ type: "web_search" as const }],
    toolChoice: mode === "force" ? ("required" as const) : ("auto" as const),
  };
}
