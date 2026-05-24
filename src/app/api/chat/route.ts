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
import { getModelOption, normalizeModel, normalizeReasoning, toDbReasoning } from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

function makeTitle(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 42 ? `${compact.slice(0, 42)}...` : compact || "New chat";
}

function toClientRole(role: string) {
  return role === "ASSISTANT" ? "assistant" : "user";
}

type ChatCompletionResponse = {
  choices?: {
    message?: {
      content?: string | null;
    };
  }[];
  error?: {
    message?: string;
  };
};

type ResponsesStreamRequest = {
  model: string;
  instructions: string;
  input: unknown[];
  reasoning: {
    effort: string;
  };
  store: false;
  stream: true;
};

type ResponsesStreamEvent = {
  type?: string;
  delta?: string;
  error?: {
    message?: string;
  };
};

type ChatCompletionStreamEvent = {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }[];
  error?: {
    message?: string;
  };
};

function parseResponsesDelta(line: string) {
  const payload = line.replace(/^data:\s*/, "").trim();
  if (!payload || payload === "[DONE]") return "";

  const data = JSON.parse(payload) as ResponsesStreamEvent;

  if (data.type === "error") {
    throw new Error(data.error?.message ?? "OpenAI stream returned an error.");
  }

  return data.type === "response.output_text.delta" ? (data.delta ?? "") : "";
}

async function createResponsesStream(body: ResponsesStreamRequest) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseURL = optionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1";

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
    let data: ChatCompletionResponse = {};
    try {
      data = text ? (JSON.parse(text) as ChatCompletionResponse) : {};
    } catch {
      data = {};
    }
    throw new Error(
      data.error?.message ?? (text || `OpenAI request failed: ${response.status}`),
    );
  }

  if (!response.body) {
    throw new Error("OpenAI response did not include a stream body.");
  }

  return response.body;
}

function parseChatCompletionDelta(line: string) {
  const payload = line.replace(/^data:\s*/, "").trim();
  if (!payload || payload === "[DONE]") return "";

  const data = JSON.parse(payload) as ChatCompletionStreamEvent;

  if (data.error?.message) {
    throw new Error(data.error.message);
  }

  return data.choices?.[0]?.delta?.content ?? "";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error.";
}

function getUpstreamModel(model: string) {
  if (model === "gpt-5.5") {
    return optionalEnv("OPENAI_TEXT_MODEL") || model;
  }

  if (model === "deepseek-v4-flash") {
    return optionalEnv("DEEPSEEK_FLASH_MODEL") || model;
  }

  if (model === "deepseek-v4-pro") {
    return optionalEnv("DEEPSEEK_PRO_MODEL") || model;
  }

  return model;
}

async function createDeepSeekStream({
  model,
  input,
  reasoning,
}: {
  model: string;
  input: { role: string; content: unknown }[];
  reasoning: string;
}) {
  const apiKey = requireEnv("DEEPSEEK_API_KEY");
  const baseURL = optionalEnv("DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1";

  const messages = [
    {
      role: "system",
      content:
        [
          "You are StudyMate, a concise, friendly AI study assistant. Help users learn clearly.",
          "Answer in the user's language unless they ask otherwise.",
          "When speaking Japanese, do not use polite/formal Japanese; reply in a more casual style.",
          "Format answers as clean Markdown: use short headings, bullets or numbered lists for grouped points, and fenced code blocks for code, commands, or config.",
          "Do not use horizontal rules, repeated separator lines, or decorative dividers.",
        ].join(" "),
    },
    ...input.map((item) => ({
      role: item.role,
      content:
        typeof item.content === "string"
          ? item.content
          : (item.content as { text?: string }[])
              .filter((part) => typeof part.text === "string")
              .map((part) => part.text)
      .join("\n\n"),
    })),
  ];
  const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model,
      messages,
      reasoning_effort: reasoning === "xhigh" ? "max" : "high",
      thinking: { type: "enabled" },
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let data: ChatCompletionResponse = {};
    try {
      data = text ? (JSON.parse(text) as ChatCompletionResponse) : {};
    } catch {
      data = {};
    }
    throw new Error(
      data.error?.message ?? (text || `DeepSeek request failed: ${response.status}`),
    );
  }

  if (!response.body) {
    throw new Error("DeepSeek response did not include a stream body.");
  }

  return response.body;
}

export async function POST(request: Request) {
  const rateLimit = await checkRateLimit(request, {
    namespace: "chat",
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });

  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: rateLimitHeaders(rateLimit) },
    );
  }

  try {
    validateMultipartRequestSize(request);
  } catch (error) {
    const message =
      error instanceof AttachmentValidationError ? error.message : "Request body is too large.";

    return NextResponse.json({ error: message }, { status: 413 });
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const message = String(formData.get("message") ?? "").trim();
  const sessionId = String(formData.get("sessionId") ?? "").trim();
  const model = normalizeModel(formData.get("model"));
  const upstreamModel = getUpstreamModel(model);
  const modelOption = getModelOption(model);
  const reasoning = normalizeReasoning(formData.get("reasoning"), model);

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

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
      { error: `${modelOption.label} does not support image uploads. Use GPT-5.5 for images.` },
      { status: 400 },
    );
  }

  const user = await getOrCreateAnonymousUser();

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

  const attachments = await prepareAttachments(files);
  const attachmentPrompt = buildAttachmentPrompt(attachments);

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

  const history = await prisma.message.findMany({
    where: {
      sessionId: session.id,
      id: { not: userMessage.id },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const imageParts = attachments
    .filter((attachment) => attachment.imageInputDataUrl)
    .map((attachment) => ({
      type: "input_image",
      image_url: attachment.imageInputDataUrl,
    }));

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

  const input: { role: string; content: unknown }[] = [
    ...history.reverse().map((item) => ({
      role: toClientRole(item.role),
      content: item.content,
    })),
    {
      role: "user",
      content: currentUserContent,
    },
  ];

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let assistantText = "";
  let buffer = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const upstream =
          modelOption.provider === "deepseek"
            ? await createDeepSeekStream({ model: upstreamModel, input, reasoning })
            : await createResponsesStream({
                model: upstreamModel,
                instructions:
                  [
                    "You are StudyMate, a concise, friendly AI study assistant. Help users learn clearly.",
                    "Answer in the user's language unless they ask otherwise.",
                    "When speaking Japanese, do not use polite/formal Japanese; reply in a more casual style.",
                    "Format answers as clean Markdown: use short headings, bullets or numbered lists for grouped points, and fenced code blocks for code, commands, or config.",
                    "Do not use horizontal rules, repeated separator lines, or decorative dividers.",
                  ].join(" "),
                input,
                reasoning: {
                  effort: reasoning,
                },
                store: false,
                stream: true,
              });
        const reader = upstream.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;

            const delta =
              modelOption.provider === "deepseek"
                ? parseChatCompletionDelta(line)
                : parseResponsesDelta(line);
            if (!delta) continue;

            assistantText += delta;
            controller.enqueue(encoder.encode(delta));
          }
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

        await prisma.session.update({
          where: { id: session.id },
          data: { updatedAt: new Date() },
        });

        controller.close();
      } catch (error) {
        const errorText = `Request failed: ${getErrorMessage(error)}`;
        const persistedText = assistantText
          ? `${assistantText}\n\n${errorText}`
          : errorText;

        controller.enqueue(
          encoder.encode(assistantText ? `\n\n${errorText}` : errorText),
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
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Session-Id": session.id,
    },
  });
}
