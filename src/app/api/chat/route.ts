import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import {
  AttachmentValidationError,
  buildAttachmentPrompt,
  isImageFile,
  prepareAttachments,
  validateAttachmentFiles,
  validateMultipartRequestSize,
} from "@/lib/files";
import { optionalEnv, requireEnv } from "@/lib/env";
import { buildHistoryInput } from "@/lib/chat-history";
import { getModelOption, normalizeModel, normalizeReasoning, toDbReasoning } from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { stringifyJsonForProxy } from "@/lib/proxy-json";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { consumeSseData } from "@/lib/sse";
import { ToolMarkupGuard } from "@/lib/tool-markup-guard";
import { buildUpstreamErrorMessage, sanitizeErrorMessage } from "@/lib/upstream-errors";
import {
  buildDeepSeekResponsesRequest,
  parseDeepSeekResponsesDelta,
} from "@/lib/deepseek-responses";
import {
  normalizeWebSearchMode,
  type WebSearchMode,
} from "@/lib/web-search";

export const runtime = "nodejs";

function makeTitle(message: string) {
  // 改行や連続スペースを 1 つの空白にして、一覧表示で崩れないタイトルにする。
  const compact = message.replace(/\s+/g, " ").trim();
  // 長すぎるタイトルはサイドバーで読みにくいため、先頭だけを使う。
  return compact.length > 42 ? `${compact.slice(0, 42)}...` : compact || "New chat";
}

// OpenAI と DeepSeek が共通で使うシステム指示を組み立てる。
// 片方だけ書き換えて挙動がずれるのを防ぐため、必ずこの関数経由で生成する。
function buildInstructions(webSearchMode: WebSearchMode) {
  return [
    "You are StudyMate, a concise, friendly AI study assistant. Help users learn clearly.",
    "Answer in the user's language unless they ask otherwise.",
    "When speaking Japanese, do not use polite/formal Japanese; reply in a more casual style.",
    "Format answers as clean Markdown: use short headings, bullets or numbered lists for grouped points, and fenced code blocks for code, commands, or config.",
    "Do not use horizontal rules, repeated separator lines, or decorative dividers.",
    ...(webSearchMode !== "off"
      ? ["When web search supplies facts, include clickable Markdown links to the sources in the answer."]
      : []),
    ...(webSearchMode === "auto"
      ? [
          "Use web search when the answer depends on current, changing, niche, or uncertain information; skip it for stable knowledge you can answer reliably.",
        ]
      : webSearchMode === "off"
        ? ["Web search is unavailable in this request. Do not simulate searches, tool calls, or tool results. Be explicit when current information cannot be verified."]
        : []),
  ].join(" ");
}

type ResponsesStreamRequest = {
  model: string;
  instructions: string;
  input: unknown[];
  reasoning: {
    effort: string;
  };
  tools?: {
    type: "web_search";
  }[];
  tool_choice?: "auto" | "required";
  safety_identifier: string;
  store: false;
  stream: true;
};

type ResponsesStreamEvent = {
  type?: string;
  delta?: string;
  annotation?: {
    type?: string;
    url?: string;
    title?: string;
  };
  error?: {
    message?: string;
  };
};

function getWebCitation(line: string) {
  const event = JSON.parse(line) as ResponsesStreamEvent;
  if (event.type !== "response.output_text.annotation.added") return null;
  const annotation = event.annotation;
  if (annotation?.type !== "url_citation" || !annotation.url) return null;

  try {
    const url = new URL(annotation.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { url: url.href, title: annotation.title?.trim() || url.hostname };
  } catch {
    return null;
  }
}

function formatWebCitations(citations: Map<string, string>) {
  if (!citations.size) return "";
  // Markdown のリンク先と表示名を安全に整えて、検索出典を保存済み本文にも残す。
  const links = [...citations].map(([url, title]) =>
    `- [${title.replace(/[\[\]\\]/g, "").replace(/\s+/g, " ")}](<${url.replace(/[<>]/g, (char) => encodeURIComponent(char))}>)`,
  );
  return `\n\nSources:\n${links.join("\n")}`;
}

function parseResponsesDelta(line: string) {
  // OpenAI Responses API は SSE で複数種類のイベントを返す。
  // クライアントへ流す必要があるのは本文差分だけなので、output_text.delta 以外は無視する。
  const data = JSON.parse(line) as ResponsesStreamEvent;

  if (data.type === "error") {
    throw new Error(data.error?.message ?? "OpenAI stream returned an error.");
  }

  return data.type === "response.output_text.delta" ? (data.delta ?? "") : "";
}

async function createResponsesStream(body: ResponsesStreamRequest) {
  // OpenAI API キーは必須。未設定なら requireEnv が明示的なエラーにする。
  const apiKey = requireEnv("OPENAI_API_KEY");
  // OPENAI_BASE_URL があればプロキシや互換 API を使い、なければ公式 API を使う。
  const baseURL = optionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1";

  const response = await fetch(`${baseURL.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: stringifyJsonForProxy(body),
  });

  if (!response.ok) {
    const text = await response.text();
    let data: { error?: { message?: string } } = {};
    try {
      data = text ? (JSON.parse(text) as { error?: { message?: string } }) : {};
    } catch {
      data = {};
    }
    throw new Error(
      data.error?.message ?? buildUpstreamErrorMessage("OpenAI", response.status, text),
    );
  }

  if (!response.body) {
    throw new Error("OpenAI response did not include a stream body.");
  }

  return response.body;
}

function getErrorMessage(error: unknown) {
  // catch の値は Error とは限らないため、画面表示用の安全な文字列に寄せる。
  return sanitizeErrorMessage(error, "Unknown error.");
}

function encodeTextStreamEvent(delta: string) {
  // 本番プロキシに通常テキストとして圧縮・結合されないよう、本文差分は SSE として送る。
  return `data: ${JSON.stringify(delta)}\n\n`;
}

function getUpstreamModel(model: string) {
  // UI 上のモデル ID と、実際に上流 API へ投げるモデル名を分離する。
  // 環境変数で差し替えできるようにして、画面側の選択肢は固定のまま運用できる。
  if (model === "gpt-6-luna") {
    return optionalEnv("OPENAI_TEXT_MODEL") || model;
  }

  if (model === "deepseek-flash") {
    return optionalEnv("DEEPSEEK_FLASH_MODEL") || model;
  }

  return model;
}

async function createDeepSeekResponsesStream({
  model,
  input,
  reasoning,
  webSearchMode,
}: {
  model: string;
  input: { role: string; content: unknown }[];
  reasoning: string;
  webSearchMode: WebSearchMode;
}) {
  // DeepSeek-V4.1-Flash は Responses API の input_image パートを受け取れるため、
  // OpenAI と同じ入力構造をそのまま渡す。画像をテキストへ潰すと視覚入力が失われる。
  const apiKey = requireEnv("DEEPSEEK_API_KEY");
  const baseURL = optionalEnv("DEEPSEEK_BASE_URL") || "https://api.deepseek.com";
  const instructions = buildInstructions(webSearchMode);
  const body = buildDeepSeekResponsesRequest({
    model,
    instructions,
    input,
    effort: reasoning,
    stream: true,
  });
  const response = await fetch(`${baseURL.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    let data: { error?: { message?: string } } = {};
    try {
      data = text ? (JSON.parse(text) as { error?: { message?: string } }) : {};
    } catch {
      data = {};
    }
    throw new Error(
      data.error?.message ?? buildUpstreamErrorMessage("DeepSeek", response.status, text),
    );
  }

  if (!response.body) {
    throw new Error("DeepSeek response did not include a stream body.");
  }

  return response.body;
}

export async function POST(request: Request) {
  // チャット送信の中心 API。
  // ここでレート制限、添付検証、セッション所有者確認、履歴保存、上流 AI ストリームの中継をまとめて行う。
  let rateLimit: Awaited<ReturnType<typeof checkRateLimit>>;

  try {
    rateLimit = await checkRateLimit(request, {
      // namespace は API 種別ごとのバケット名。画像生成とは別枠で制限する。
      namespace: "chat",
      // 匿名デバイス 1 つあたり、1 時間に 30 回までにする。
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
  } catch (error) {
    console.error("Failed to check chat rate limit", error);
    return NextResponse.json({ error: "Database is unavailable." }, { status: 503 });
  }

  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: rateLimitHeaders(rateLimit) },
    );
  }

  try {
    validateMultipartRequestSize(request);
  } catch (error) {
    const status = error instanceof AttachmentValidationError ? error.status : 400;
    const message =
      error instanceof AttachmentValidationError ? error.message : "Request body is too large.";

    return NextResponse.json({ error: message }, { status });
  }

  // multipart/form-data の解析結果。本文と添付ファイルの両方をここから取り出す。
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  // ユーザーが入力した本文。空白だけの送信は後続のチェックで拒否する。
  const message = String(formData.get("message") ?? "").trim();
  // 既存チャットに送る場合のセッション ID。新規チャットでは空文字になる。
  const sessionId = String(formData.get("sessionId") ?? "").trim();
  // クライアントから送られたモデル ID を、許可済み ID のどれかへ正規化する。
  const model = normalizeModel(formData.get("model"));
  // 実際に上流 API へ渡すモデル名。環境変数で別名に差し替え可能。
  const upstreamModel = getUpstreamModel(model);
  // 対応プロバイダーや画像入力可否など、モデルの機能情報。
  const modelOption = getModelOption(model);
  // 推論強度。モデルごとの対応値から外れていればデフォルトへ戻す。
  const reasoning = normalizeReasoning(formData.get("reasoning"), model);
  // 検索非対応モデルでは、古いクライアントの指定も off に正規化する。
  // フィールド未指定でも検索対応モデルなら auto になる。
  const webSearchMode = normalizeWebSearchMode(
    formData.get("webSearch"),
    modelOption.supportsWebSearch,
  );

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  // FormData 内の files フィールドから、実際の File オブジェクトだけを取り出す。
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);

  try {
    validateAttachmentFiles(files);
  } catch (error) {
    const status = error instanceof AttachmentValidationError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Invalid attachment.";

    return NextResponse.json({ error: message }, { status });
  }

  if (!modelOption.supportsImageInput && files.some(isImageFile)) {
    return NextResponse.json(
      { error: `${modelOption.label} does not support image uploads. Use GPT-6 Luna for images.` },
      { status: 400 },
    );
  }

  // 署名付き Cookie から匿名ユーザーを取得または作成し、以降の DB 操作の所有者にする。
  const user = await getOrCreateAnonymousUser();

  // sessionId があれば所有者一致の既存セッションを探し、なければ今回の送信で新規作成する。
  const session = sessionId
    ? await prisma.session.findFirst({
        where: { id: sessionId, userId: user.id },
      })
    : await prisma.session.create({
        data: {
          userId: user.id,
          title: makeTitle(message),
        },
      });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  // 添付ファイルを、DB 保存用のメタ情報とモデル入力用の抽出テキスト/画像 data URL に変換する。
  const attachments = await prepareAttachments(files);
  // 抽出できたテキストを、今回のユーザー入力へ差し込む追加プロンプトにする。
  const attachmentPrompt = buildAttachmentPrompt(attachments);

  // ユーザー発言は上流 API 呼び出し前に保存する。
  // ただしこの発言はこのあと currentUserContent として渡すため、履歴取得では id を除外して二重送信を避ける。
  const userMessage = await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "USER",
      content: message,
      model,
      reasoningEffort: toDbReasoning(reasoning),
      attachments: {
        create: attachments.map((attachment) => ({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          extractedText: attachment.extractedText,
          imageStoragePath: attachment.imageStoragePath,
        })),
      },
    },
  });

  if (session.title === "New chat") {
    await prisma.session.update({
      where: { id: session.id },
      data: { title: makeTitle(message) },
    });
  }

  // 上流 API に渡す会話履歴。直近 30 件だけにしてトークン量と DB 読み込み量を抑える。
  const history = await prisma.message.findMany({
    where: {
      sessionId: session.id,
      id: { not: userMessage.id },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      role: true,
      content: true,
      attachments: {
        select: {
          filename: true,
          mimeType: true,
          size: true,
          extractedText: true,
          imageStoragePath: true,
        },
      },
    },
  });

  // 画像入力に対応する添付は、Responses API の input_image パートとして追加する。
  const imageParts = attachments
    .filter((attachment) => attachment.imageInputDataUrl)
    .map((attachment) => ({
      type: "input_image",
      image_url: attachment.imageInputDataUrl,
    }));

  // 今回のユーザー入力。添付テキスト、本文、画像の順に 1 つの user メッセージへまとめる。
  const currentUserContent = [
    ...(attachmentPrompt
      ? [
          {
            type: "input_text",
            text: attachmentPrompt,
          },
        ]
      : []),
    {
      type: "input_text",
      text: message,
    },
    ...imageParts,
  ];

  // 過去の添付も上限内で復元し、PDF や画像について続けて質問できるようにする。
  const historyInput = await buildHistoryInput(history, modelOption.supportsImageInput);
  const input: { role: string; content: unknown }[] = [
    ...historyInput,
    {
      role: "user",
      content: currentUserContent,
    },
  ];
  // 上流 API の byte stream を文字列として読むためのデコーダー。
  const decoder = new TextDecoder();
  // クライアントへ返す text/plain stream を byte stream に戻すためのエンコーダー。
  const encoder = new TextEncoder();
  // ストリーム中にクライアントへ返したアシスタント本文の累積値。完了後に DB へ保存する。
  let assistantText = "";
  // SSE の 1 行が chunk の境界で分断されることがあるため、未処理の末尾を保持する。
  let buffer = "";

  const stream = new ReadableStream({
    async start(controller) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        // OpenAI と DeepSeek はストリーム形式が少し違う。
        // この API で差分を吸収し、フロントエンドには常にプレーンテキストの連続 chunk として返す。
        const upstream =
          modelOption.provider === "deepseek"
            ? await createDeepSeekResponsesStream({
                model: upstreamModel,
                input,
                reasoning,
                webSearchMode,
              })
            : await createResponsesStream({
                model: upstreamModel,
                instructions: buildInstructions(webSearchMode),
                input,
                reasoning: {
                  effort: reasoning,
                },
                safety_identifier: user.id,
                ...(webSearchMode !== "off"
                  ? {
                      tools: [{ type: "web_search" }],
                      tool_choice: webSearchMode === "force" ? "required" as const : "auto" as const,
                    }
                  : {}),
                store: false,
                stream: true,
              });
        // 上流 AI からの SSE を読み取る reader。
        reader = upstream.getReader();
        const guard = modelOption.provider === "deepseek" ? new ToolMarkupGuard() : null;
        let completed = false;
        const webCitations = new Map<string, string>();

        const forwardText = (delta: string) => {
          if (!delta) return;
          assistantText += delta;
          controller.enqueue(encoder.encode(encodeTextStreamEvent(delta)));
        };

        const forwardData = (data: string[]) => {
          for (const payload of data) {
            if (modelOption.provider === "openai") {
              const citation = getWebCitation(payload);
              if (citation) webCitations.set(citation.url, citation.title);
            }
            // プロバイダー別の形式から、画面に出す本文差分だけを取り出す。
            const delta =
              modelOption.provider === "deepseek"
                ? parseDeepSeekResponsesDelta(payload)
                : parseResponsesDelta(payload);
            if (guard && JSON.parse(payload).type === "response.completed") completed = true;
            forwardText(guard ? guard.push(delta) : delta);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // 最後の未完成行は次の chunk と結合する。
          const batch = consumeSseData(buffer);
          buffer = batch.remainder;
          forwardData(batch.data);
        }

        // TextDecoder 内の未確定 byte と、改行なしで終わる最後の data 行を処理する。
        buffer += decoder.decode();
        const finalBatch = consumeSseData(buffer, true);
        buffer = finalBatch.remainder;
        forwardData(finalBatch.data);

        if (guard) {
          if (!completed) throw new Error("DeepSeek stream ended before completion. Please retry.");
          forwardText(guard.finish());
          if (!assistantText.trim()) throw new Error("DeepSeek returned an empty response. Please retry.");
        }

        if (modelOption.provider === "openai") {
          forwardText(formatWebCitations(webCitations));
        }

        await prisma.message.create({
          data: {
            sessionId: session.id,
            role: "ASSISTANT",
            content: assistantText,
            model,
            reasoningEffort: toDbReasoning(reasoning),
          },
        });

        // ユーザーに実際に流した本文だけをアシスタント発言として保存する。
        // 保存後に updatedAt を更新し、セッション一覧の並び順にも反映させる。
        await prisma.session.update({
          where: { id: session.id },
          data: { updatedAt: new Date() },
        });

        controller.close();
      } catch (error) {
        // 異常出力を検出したら上流の読み取りも止める。
        await reader?.cancel().catch(() => {});
        // 上流 API が途中で失敗しても、すでにユーザーへ返した本文は失わない。
        // 途中本文があれば末尾にエラー文を追記し、画面表示と DB 履歴が同じ内容になるよう保存する。
        const errorText = `Request failed: ${getErrorMessage(error)}`;
        const persistedText = assistantText
          ? `${assistantText}\n\n${errorText}`
          : errorText;

        controller.enqueue(
          encoder.encode(encodeTextStreamEvent(assistantText ? `\n\n${errorText}` : errorText)),
        );

        await prisma.message.create({
          data: {
            sessionId: session.id,
            role: "ASSISTANT",
            content: persistedText,
            model,
            reasoningEffort: toDbReasoning(reasoning),
          },
        });

        await prisma.session.update({
          where: { id: session.id },
          data: { updatedAt: new Date() },
        });

        controller.close();
      } finally {
        reader?.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      "X-Session-Id": session.id,
    },
  });
}
