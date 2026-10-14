import { describe, expect, it } from "vitest";
import {
  AttachmentValidationError,
  MAX_MULTIPART_REQUEST_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
  buildAttachmentPrompt,
  isImageFile,
  validateAttachmentFiles,
  validateMultipartRequestSize,
} from "./files";

function fakeFile(name: string, type: string, size: number) {
  return { name, type, size } as File;
}

function captureAttachmentError(run: () => void) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AttachmentValidationError);
    return error as AttachmentValidationError;
  }

  throw new Error("Expected attachment validation to fail.");
}

describe("attachment validation", () => {
  it("accepts supported MIME types and text extensions", () => {
    const files = [
      fakeFile("notes.txt", "application/octet-stream", 20),
      fakeFile("scan.pdf", "application/pdf", 30),
      fakeFile("diagram.png", "image/png", 40),
    ];

    expect(() => validateAttachmentFiles(files)).not.toThrow();
    expect(isImageFile(files[2])).toBe(true);
  });

  it("rejects unsupported files", () => {
    const zipError = captureAttachmentError(() =>
      validateAttachmentFiles([fakeFile("archive.zip", "application/zip", 20)]),
    );
    const svgError = captureAttachmentError(() =>
      validateAttachmentFiles([fakeFile("vector.svg", "image/svg+xml", 20)]),
    );
    const heicError = captureAttachmentError(() =>
      validateAttachmentFiles([fakeFile("photo.heic", "image/heic", 20)]),
    );
    const gifError = captureAttachmentError(() =>
      validateAttachmentFiles([fakeFile("animated.gif", "image/gif", 20)]),
    );

    expect(zipError).toMatchObject({
      message: "Unsupported file type: archive.zip",
      status: 415,
    });
    expect(svgError.status).toBe(415);
    expect(heicError.status).toBe(415);
    expect(gifError.status).toBe(415);
  });

  it("enforces file count, individual size, and total size limits", () => {
    const tooMany = Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, index) =>
      fakeFile(`${index}.txt`, "text/plain", 1),
    );
    const individuallyTooLarge = fakeFile(
      "large.txt",
      "text/plain",
      MAX_UPLOAD_FILE_BYTES + 1,
    );
    const combinedFileSize = Math.floor(MAX_UPLOAD_TOTAL_BYTES / 6) + 1;
    const combinedTooLarge = Array.from({ length: 6 }, (_, index) => `${index}.txt`).map((name) =>
      fakeFile(name, "text/plain", combinedFileSize),
    );

    expect(captureAttachmentError(() => validateAttachmentFiles(tooMany)).status).toBe(413);
    expect(
      captureAttachmentError(() => validateAttachmentFiles([individuallyTooLarge])),
    ).toMatchObject({ message: "File is too large: large.txt", status: 413 });
    expect(captureAttachmentError(() => validateAttachmentFiles(combinedTooLarge))).toMatchObject({
      message: "Total upload size is too large.",
      status: 413,
    });
  });

  it("rejects invalid and oversized multipart content lengths", () => {
    const invalid = new Request("https://example.test", {
      headers: { "content-length": "invalid" },
    });
    const tooLarge = new Request("https://example.test", {
      headers: { "content-length": String(MAX_MULTIPART_REQUEST_BYTES + 1) },
    });
    const negative = new Request("https://example.test", {
      headers: { "content-length": "-1" },
    });
    const unknown = new Request("https://example.test");

    expect(captureAttachmentError(() => validateMultipartRequestSize(invalid))).toMatchObject({
      message: "Request body size is invalid.",
      status: 400,
    });
    expect(captureAttachmentError(() => validateMultipartRequestSize(negative)).status).toBe(400);
    expect(captureAttachmentError(() => validateMultipartRequestSize(tooLarge))).toMatchObject({
      message: "Request body is too large.",
      status: 413,
    });
    expect(() => validateMultipartRequestSize(unknown)).not.toThrow();
  });
});

describe("buildAttachmentPrompt", () => {
  it("includes extracted text with file boundaries and skips binary-only files", () => {
    const prompt = buildAttachmentPrompt([
      { filename: "notes.txt", mimeType: "text/plain", size: 5, extractedText: "alpha" },
      { filename: "image.png", mimeType: "image/png", size: 10 },
      { filename: "data.csv", mimeType: "text/csv", size: 4, extractedText: "beta" },
    ]);

    expect(prompt).toContain("File: notes.txt\nType: text/plain\nContent:\nalpha");
    expect(prompt).toContain("\n\n---\n\n");
    expect(prompt).toContain("File: data.csv\nType: text/csv\nContent:\nbeta");
    expect(prompt).not.toContain("image.png");
  });

  it("returns an empty prompt when no text was extracted", () => {
    expect(
      buildAttachmentPrompt([{ filename: "image.png", mimeType: "image/png", size: 10 }]),
    ).toBe("");
  });
});
