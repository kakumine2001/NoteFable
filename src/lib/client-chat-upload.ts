import { upload } from "@vercel/blob/client";
import { msg } from "@/lib/i18n/translate";

export async function cleanupClientUploads(tickets: string[]) {
  if (!tickets.length) return;
  await fetch("/api/uploads", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploads: tickets }), keepalive: true, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

export async function uploadChatFiles(files: File[], onProgress: (name: string, index: number, total: number, percentage: number) => void): Promise<string[]> {
  if (!files.length) return [];
  const response = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: files.map((file) => ({ name: file.name, type: file.type, size: file.size })) }) }).catch(() => { throw new Error(msg("Unable to upload attachments. Check your connection and try sending again.")); });
  const body = await response.json().catch(() => ({ error: msg("Unable to prepare attachments. Try sending again.") }));
  if (!response.ok) throw new Error(body.error ?? msg("Unable to start attachment upload."));
  const uploads = body.uploads as { path: string; ticket: string }[];
  if (!Array.isArray(uploads) || uploads.length !== files.length) throw new Error(msg("Invalid upload response."));
  const tickets = uploads.map((item) => item.ticket);
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      onProgress(file.name, index + 1, files.length, 0);
      if (body.mode === "local") {
        const result = await fetch(`/api/uploads/local?ticket=${encodeURIComponent(uploads[index].ticket)}`, { method: "PUT", body: file });
        if (!result.ok) throw new Error(`Upload failed: ${file.name}. Please try again.`);
      } else {
        await upload(uploads[index].path, file, { access: "private", handleUploadUrl: "/api/uploads", clientPayload: uploads[index].ticket, contentType: file.type || "application/octet-stream", multipart: true,
          onUploadProgress: ({ percentage }) => onProgress(file.name, index + 1, files.length, Math.round(percentage)),
        });
      }
      onProgress(file.name, index + 1, files.length, 100);
    }
    return tickets;
  } catch {
    await cleanupClientUploads(tickets);
    throw new Error(msg("Unable to upload attachments. Check your connection and try sending again."));
  }
}
