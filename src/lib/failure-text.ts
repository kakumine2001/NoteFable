import { fmt, localizeSystemText, type Translate } from "@/lib/i18n/translate";

// システムが付け足した失敗文の位置と詳細。本文の言い回しから失敗を推測しない。
// activity JSON と SSE に残すので DB スキーマの変更は不要。以前のメタデータのない回答は原文で表示する。
export type FailureInfo = { offset: number; detail: string };

export function isFailureInfo(value: unknown): value is FailureInfo {
  const info = value as Partial<FailureInfo> | null;
  return !!info && typeof info === "object" && typeof info.offset === "number" && Number.isSafeInteger(info.offset) && info.offset >= 0 && typeof info.detail === "string";
}

export function failureText(detail: string) {
  return fmt("Request failed: {detail}", { detail });
}

export function localizeFailureText(content: string, t: Translate, failure?: FailureInfo) {
  if (!isFailureInfo(failure) || content.slice(failure.offset) !== failureText(failure.detail)) return content;
  return content.slice(0, failure.offset) + t("Request failed: {detail}", { detail: localizeSystemText(failure.detail, t) });
}
