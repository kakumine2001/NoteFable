// Shared by the composer and API; this module must stay browser-safe.
export const MAX_UPLOAD_FILES = 10;
// Multipart uploads pass through Vercel Functions (4.5 MB body limit).
// Reserve space for message text, filenames and form boundaries.
export const MAX_UPLOAD_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 4 * 1024 * 1024;
export const MAX_MULTIPART_REQUEST_BYTES = 4_500_000;
export const MAX_CLAUDE_IMAGE_BYTES = 5 * 1024 * 1024;
