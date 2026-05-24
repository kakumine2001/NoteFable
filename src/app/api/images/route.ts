import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { optionalEnv, requireEnv } from "@/lib/env";
import {
  DEFAULT_MODEL,
  getModelOption,
  normalizeModel,
  normalizeReasoning,
  toDbReasoning,
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { writeStoredImage } from "@/lib/storage";

export const runtime = "nodejs";

type ImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
type ImageQuality = "low" | "medium" | "high" | "auto";

type ImageRequestBody = {
  prompt?: unknown;
  size?: unknown;
  quality?: unknown;
  sessionId?: unknown;
  model?: unknown;
  reasoning?: unknown;
};

type ImageGenerationResponse = {
  output?: {
    type?: string;
    result?: string;
  }[];
  error?: {
    message?: string;
  } | null;
};

type ImageGenerationStreamEvent = {
  type?: string;
  partial_image_b64?: string;
  response?: ImageGenerationResponse;
  error?: {
    message?: string;
  };
};

const SUPPORTED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
const SUPPORTED_QUALITIES = new Set(["low", "medium", "high", "auto"]);
const MAX_PROMPT_CHARS = 4_000;

function makeTitle(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 42 ? `${compact.slice(0, 42)}...` : compact || "New chat";
}

function normalizeSize(value: unknown): ImageSize {
  return typeof value === "string" && SUPPORTED_SIZES.has(value)
    ? (value as ImageSize)
    : "auto";
}

function normalizeQuality(value: unknown): ImageQuality {
  return typeof value === "string" && SUPPORTED_QUALITIES.has(value)
    ? (value as ImageQuality)
    : "auto";
}

function normalizeReasoningValue(value: unknown, model: string) {
  return normalizeReasoning(typeof value === "string" ? value : null, model);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Image generation failed.";
}

function makeImageEvent(
  type: "partial" | "completed",
  imageBase64: string,
  sessionId?: string,
) {
  return `${JSON.stringify({
    type,
    sessionId,
    image: {
      mimeType: "image/png",
      dataUrl: `data:image/png;base64,${imageBase64}`,
    },
  })}\n`;
}

function parseStreamPayload(line: string) {
  const payload = line.replace(/^data:\s*/, "").trim();

  if (!payload || payload === "[DONE]") return null;

  return JSON.parse(payload) as ImageGenerationStreamEvent;
}

function findCompletedImage(data?: ImageGenerationResponse) {
  return data?.output?.find((item) => item.type === "image_generation_call")?.result;
}

async function createUpstreamImageStream(prompt: string, size: ImageSize, quality: ImageQuality) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseURL = optionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1";

  const response = await fetch(`${baseURL.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: optionalEnv("OPENAI_IMAGE_RESPONSE_MODEL") || "gpt-5.5",
      input: prompt,
      stream: true,
      tools: [
        {
          type: "image_generation",
          model: optionalEnv("OPENAI_IMAGE_MODEL") || "gpt-image-2",
          size,
          quality,
          output_format: "png",
          partial_images: 1,
        },
      ],
      tool_choice: {
        type: "image_generation",
      },
      store: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let data: ImageGenerationResponse = {};

    try {
      data = text ? (JSON.parse(text) as ImageGenerationResponse) : {};
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

export async function POST(request: Request) {
  const rateLimit = await checkRateLimit(request, {
    namespace: "images",
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });

  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: rateLimitHeaders(rateLimit) },
    );
  }

  let body: ImageRequestBody;

  try {
    body = (await request.json()) as ImageRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const model = normalizeModel(typeof body.model === "string" ? body.model : DEFAULT_MODEL);
  const modelOption = getModelOption(model);
  const reasoning = normalizeReasoningValue(body.reasoning, model);

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  if (!modelOption.supportsImageGeneration) {
    return NextResponse.json(
      { error: `${modelOption.label} does not support image generation. Use GPT-5.5 for images.` },
      { status: 400 },
    );
  }

  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: "Prompt is too long." }, { status: 413 });
  }

  try {
    const user = await getOrCreateAnonymousUser();
    const session = sessionId
      ? await prisma.session.findFirst({
          where: { id: sessionId, userId: user.id },
        })
      : await prisma.session.create({
          data: {
            userId: user.id,
            title: makeTitle(prompt),
          },
        });

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const upstream = await createUpstreamImageStream(
      prompt,
      normalizeSize(body.size),
      normalizeQuality(body.quality),
    );
    const reader = upstream.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    const stream = new ReadableStream({
      async start(controller) {
        let latestImageBase64 = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data:")) continue;

              const event = parseStreamPayload(line);
              if (!event) continue;

              if (event.type === "error") {
                throw new Error(event.error?.message ?? "OpenAI stream returned an error.");
              }

              if (
                event.type === "response.image_generation_call.partial_image" &&
                event.partial_image_b64
              ) {
                latestImageBase64 = event.partial_image_b64;
                controller.enqueue(
                  encoder.encode(makeImageEvent("partial", event.partial_image_b64)),
                );
              }

              if (event.type === "response.completed") {
                const imageBase64 = findCompletedImage(event.response) ?? latestImageBase64;
                if (!imageBase64) {
                  throw new Error("OpenAI did not return image data.");
                }
                const imageBuffer = Buffer.from(imageBase64, "base64");
                const imageStoragePath = await writeStoredImage(imageBuffer, "image/png");

                await prisma.message.create({
                  data: {
                    sessionId: session.id,
                    role: "USER",
                    content: prompt,
                    model,
                    reasoningEffort: toDbReasoning(reasoning),
                  },
                });

                await prisma.message.create({
                  data: {
                    sessionId: session.id,
                    role: "ASSISTANT",
                    content: "",
                    model,
                    reasoningEffort: toDbReasoning(reasoning),
                    attachments: {
                      create: {
                        filename: "generated-image.png",
                        mimeType: "image/png",
                        size: imageBuffer.byteLength,
                        imageStoragePath,
                      },
                    },
                  },
                });

                await prisma.session.update({
                  where: { id: session.id },
                  data: {
                    title: session.title === "New chat" ? makeTitle(prompt) : session.title,
                    updatedAt: new Date(),
                  },
                });

                controller.enqueue(encoder.encode(makeImageEvent("completed", imageBase64, session.id)));
              }
            }
          }

          controller.close();
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({ type: "error", error: getErrorMessage(error) })}\n`,
            ),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
