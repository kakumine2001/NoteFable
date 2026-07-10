import type { Message } from "@/types/chat";

function formatMessageForNotion(message: Message) {
  const label = message.role === "USER" ? "User" : "Assistant";
  const parts = [`${label}:`, message.content.trim()];
  const attachments = message.attachments ?? [];
  const generatedImages = message.generatedImages ?? [];

  if (attachments.length) {
    parts.push(
      attachments
        .map((attachment) => `Attachment: ${attachment.filename} (${attachment.mimeType})`)
        .join("\n"),
    );
  }

  if (generatedImages.length) {
    parts.push(
      generatedImages.map((image) => `Generated image: ${image.mimeType}`).join("\n"),
    );
  }

  return parts.filter(Boolean).join("\n");
}

export function formatTranscriptForNotion(messages: Message[]) {
  return messages
    .filter((message) => message.content.trim() || message.attachments?.length || message.generatedImages?.length)
    .map(formatMessageForNotion)
    .join("\n\n---\n\n");
}
