import { optionalEnv, requireEnv } from "@/lib/env";
import type { ModelProvider } from "@/lib/models";
import { stringifyJsonForProxy } from "@/lib/proxy-json";
import { buildDeepSeekResponsesRequest } from "@/lib/deepseek-responses";
import { buildAnthropicRequest, extractAnthropicText, requestAnthropic } from "@/lib/anthropic-messages";
import { isEmojiIcon } from "@/lib/emoji-icon";

// タイトル生成は本文の返答より先に終わる想定。長引いても返答の完了を待たせすぎない。
const TITLE_TIMEOUT_MS = 6000;
// 長い貼り付けや添付テキストを丸ごと送らないよう、最初の発言の先頭だけを使う。
const MAX_INPUT_CHARS = 2000;
const MAX_TITLE_CHARS = 60;

// 同じ 1 回の呼び出しで、一覧のアイコンにする絵文字も選ばせる（追加のリクエストはしない）。
const TITLE_INSTRUCTIONS = [
  "Write a short title for a chat, based only on the user's first message.",
  "Use the same language as the message. Keep it under 6 words, or about 20 characters for Japanese and Chinese.",
  "Start with one emoji that fits the topic, then a space, then the title.",
  "Output only the emoji and the title: no quotes, no trailing punctuation, no explanation.",
  "Do not answer the message.",
].join(" ");

const TITLE_PREFIX = /^(title|タイトル|标题)\s*[:：]\s*/i;

type ResponsesOutput = {
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
};

// 非ストリームの Responses API から本文テキストだけを取り出す。
export function extractResponseText(data: ResponsesOutput) {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");
}

// モデルが付けがちな引用符・前置き・末尾の句読点を落とし、一覧に出せる長さへ整える。
export function cleanTitle(raw: string) {
  const firstLine = raw.trim().split(/\r?\n/)[0] ?? "";
  const title = firstLine
    .replace(TITLE_PREFIX, "")
    .replace(/^["'“”‘’「『]+|["'“”‘’」』*_`]+$/g, "")
    .replace(/[。.!！?？]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  return title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS)}...` : title;
}

export type ChatTitle = { title: string | null; icon: string | null };

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
// 行頭の飾り：空白・引用符・Markdown の強調や見出し・箇条書き・「Title:」。順番がどうでも落とせるよう繰り返しで外す。
// # と * はキーキャップ絵文字（#️⃣ *️⃣）の一部なら残す。
const LEADING_NOISE = /^(?:\s|["'“”‘’「『_>`]|[#*](?!️?⃣)|[-•]\s|(?:title|タイトル|标题)\s*[:：])+/i;
// 絵文字とタイトルの間に入りがちな区切り。
const SEPARATOR = /^[\s\-–—:：|·・]+/;

// 行頭の絵文字 1 つ。© ® ™ は絵文字扱いだが文字として書かれることが多いので、アイコンにはしない。
function leadingEmoji(text: string) {
  const first = graphemes.segment(text)[Symbol.iterator]().next().value?.segment ?? "";
  return isEmojiIcon(first) && !/^[©®™]/.test(first) ? first : null;
}

// 「🍳 パスタの作り方」を絵文字とタイトルに分ける。先頭が絵文字でなければアイコンなし（タイトルだけ使う）。
// 絵文字だけの行の次にタイトルが来た場合はその行を、絵文字が続いた場合は 2 つ目以降を捨てる。
export function parseTitleOutput(raw: string): ChatTitle {
  const lines = raw.split(/\r?\n/).map((line) => line.replace(LEADING_NOISE, "").trim()).filter(Boolean);
  const line = lines[0] ?? "";
  const icon = leadingEmoji(line);
  if (!icon) return { title: cleanTitle(line), icon: null };
  let rest = line.slice(icon.length).replace(SEPARATOR, "");
  for (let more = leadingEmoji(rest); more; more = leadingEmoji(rest)) rest = rest.slice(more.length).replace(SEPARATOR, "");
  return { title: cleanTitle(rest || (lines[1] ?? "")), icon };
}

// 最初のメッセージから AI でタイトルとアイコンを作る。リクエスト失敗は例外、途中で打ち切られた応答は null。
// 返ってきたタイトルやアイコンが使えないときはその項目だけ null で、呼び出し側は仮タイトル・アイコンなしのままにする。
export async function generateChatTitle({
  provider,
  model,
  message,
  userId,
}: {
  provider: ModelProvider;
  model: string;
  message: string;
  userId: string;
}) {
  const input = message.slice(0, MAX_INPUT_CHARS);
  const signal = AbortSignal.timeout(TITLE_TIMEOUT_MS);

  if (provider === "anthropic") {
    const response = await requestAnthropic(buildAnthropicRequest({
      model,
      instructions: TITLE_INSTRUCTIONS,
      input: [{ role: "user", content: input }],
      effort: "low",
      stream: false,
      maxTokens: 2048,
    }), signal);
    const data = await response.json();
    if (data.stop_reason !== "end_turn") return null;
    return parseTitleOutput(extractAnthropicText(data));
  }

  const request =
    provider === "deepseek"
      ? {
          url: `${(optionalEnv("DEEPSEEK_BASE_URL") || "https://api.deepseek.com").replace(/\/$/, "")}/responses`,
          key: requireEnv("DEEPSEEK_API_KEY"),
          // 対応する推論強度の最小値（low）を使う。
          body: JSON.stringify(
            buildDeepSeekResponsesRequest({
              model,
              instructions: TITLE_INSTRUCTIONS,
              input,
              effort: "low",
              // DeepSeek は推論を無効にできず、low でも推論文が長い。256 では本文が出る前に打ち切られた。
              maxOutputTokens: 2048,
              stream: false,
            }),
          ),
        }
      : {
          url: `${(optionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "")}/responses`,
          key: requireEnv("OPENAI_API_KEY"),
          body: stringifyJsonForProxy({
            model,
            instructions: TITLE_INSTRUCTIONS,
            input,
            reasoning: { effort: "none" },
            max_output_tokens: 256,
            safety_identifier: userId,
            store: false,
            stream: false,
          }),
        };

  const response = await fetch(request.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${request.key}`, "Content-Type": "application/json" },
    body: request.body,
    signal,
  });
  if (!response.ok) throw new Error(`Title request failed with status ${response.status}.`);

  return parseTitleOutput(extractResponseText((await response.json()) as ResponsesOutput));
}
