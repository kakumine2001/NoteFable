// Shared by the composer and API; this module must stay browser-safe.
export const MAX_UPLOAD_FILES = 10;
// File binaries go directly to private Blob; the composer enforces these caps.
export const MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
export const MAX_MULTIPART_REQUEST_BYTES = 4_500_000;
export const MAX_CLAUDE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_CLAUDE_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;
