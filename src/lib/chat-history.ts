import { buildAttachmentPrompt, type PreparedAttachment } from "@/lib/files";
import { isSupportedImageMimeType } from "@/lib/image-types";
import { readStoredImage } from "@/lib/storage";

const MAX_HISTORY_ATTACHMENT_TEXT_CHARS = 120_000;
const MAX_HISTORY_IMAGE_FILES = 3;
const MAX_HISTORY_IMAGE_BYTES = 15 * 1024 * 1024;

type HistoryAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  extractedText: string | null;
  imageStoragePath: string | null;
};

export type HistoryMessage = {
  id: string;
  role: string;
  content: string;
  attachments: HistoryAttachment[];
};

type HistoryInput = {
  role: string;
  content: unknown;
};

export async function buildHistoryInput(
  newestFirstMessages: HistoryMessage[],
  supportsImageInput: boolean,
): Promise<HistoryInput[]> {
  // 新しい添付から優先して、会話履歴全体の上限内に収める。
  let remainingTextChars = MAX_HISTORY_ATTACHMENT_TEXT_CHARS;
  let remainingImageFiles = supportsImageInput ? MAX_HISTORY_IMAGE_FILES : 0;
  let remainingImageBytes = supportsImageInput ? MAX_HISTORY_IMAGE_BYTES : 0;
  const inputByMessageId = new Map<string, HistoryInput>();

  for (const message of newestFirstMessages) {
    const role = message.role === "ASSISTANT" ? "assistant" : "user";

    if (role !== "user" || !message.attachments.length) {
      inputByMessageId.set(message.id, { role, content: message.content });
      continue;
    }

    const textAttachments: PreparedAttachment[] = [];
    const imageParts: { type: "input_image"; image_url: string }[] = [];

    for (const attachment of message.attachments) {
      if (attachment.extractedText && remainingTextChars > 0) {
        const extractedText = attachment.extractedText.slice(0, remainingTextChars);
        remainingTextChars -= extractedText.length;
        textAttachments.push({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          extractedText,
        });
      }

      if (
        remainingImageFiles <= 0 ||
        !attachment.imageStoragePath ||
        !isSupportedImageMimeType(attachment.mimeType) ||
        attachment.size > remainingImageBytes
      ) {
        continue;
      }

      try {
        const image = await readStoredImage(attachment.imageStoragePath);
        if (image.byteLength > remainingImageBytes) continue;

        imageParts.push({
          type: "input_image",
          image_url: `data:${attachment.mimeType};base64,${image.toString("base64")}`,
        });
        remainingImageFiles -= 1;
        remainingImageBytes -= image.byteLength;
      } catch {
        // 一時ディスク(ホスティング再起動後など)から消えた画像は、本文履歴だけで会話を続ける。
      }
    }

    const attachmentPrompt = buildAttachmentPrompt(textAttachments);

    if (!attachmentPrompt && !imageParts.length) {
      inputByMessageId.set(message.id, { role, content: message.content });
      continue;
    }

    inputByMessageId.set(message.id, {
      role,
      content: [
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
          text: message.content,
        },
        ...imageParts,
      ],
    });
  }

  return [...newestFirstMessages]
    .reverse()
    .map((message) => inputByMessageId.get(message.id) as HistoryInput);
}
