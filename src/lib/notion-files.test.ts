import { describe, expect, it } from "vitest";
import {
  formatByteSize,
  getNotionFileValidationError,
  getNotionPartChunkIndexes,
  getNotionStagingChunkPath,
  getNotionTransferredBytes,
  getNotionUploadPlan,
  getStagingChunkCount,
  getStagingChunkSize,
  isNotionImageFilename,
  isSupportedNotionFilename,
  NOTION_MAX_FILE_BYTES,
  NOTION_MAX_PART_COUNT,
  NOTION_SINGLE_PART_MAX_BYTES,
  NOTION_TRANSFER_CHUNK_BYTES,
} from "./notion-files";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

describe("getNotionUploadPlan", () => {
  it("uses a single part at and below 20 MiB", () => {
    expect(getNotionUploadPlan(1)).toEqual({ mode: "single_part", partCount: 1 });
    expect(getNotionUploadPlan(NOTION_SINGLE_PART_MAX_BYTES)).toEqual({
      mode: "single_part",
      partCount: 1,
    });
  });

  it("splits into 10 MiB parts above 20 MiB", () => {
    expect(getNotionUploadPlan(NOTION_SINGLE_PART_MAX_BYTES + 1)).toEqual({
      mode: "multi_part",
      partCount: 3,
    });
    expect(getNotionUploadPlan(100 * MIB).partCount).toBe(10);
  });

  it("stays within the part_number limit at the 5 GiB boundary", () => {
    const plan = getNotionUploadPlan(NOTION_MAX_FILE_BYTES);

    expect(plan.mode).toBe("multi_part");
    expect(plan.partCount).toBe(512);
    expect(plan.partCount).toBeLessThanOrEqual(NOTION_MAX_PART_COUNT);
  });

  it("keeps every part inside the Notion 5-20 MiB range except the last", () => {
    // 端数が出るサイズで、最後の 1 パートだけが小さくなることを確認する。
    const size = 20 * MIB + 1;
    const plan = getNotionUploadPlan(size);
    const sizes = Array.from({ length: plan.partCount }, (_, index) => {
      const start = index * NOTION_TRANSFER_CHUNK_BYTES;
      return Math.min(NOTION_TRANSFER_CHUNK_BYTES, size - start);
    });

    expect(sizes).toEqual([10 * MIB, 10 * MIB, 1]);
    expect(sizes.slice(0, -1).every((part) => part >= 5 * MIB && part <= 20 * MIB)).toBe(true);
    expect(sizes.at(-1)).toBe(1);
    expect(sizes.reduce((total, part) => total + part, 0)).toBe(size);
  });
});

describe("staging chunks", () => {
  it("counts 10 MiB units", () => {
    expect(getStagingChunkCount(0)).toBe(0);
    expect(getStagingChunkCount(10 * MIB)).toBe(1);
    expect(getStagingChunkCount(10 * MIB + 1)).toBe(2);
    expect(getStagingChunkCount(20 * MIB)).toBe(2);
    expect(getStagingChunkCount(NOTION_MAX_FILE_BYTES)).toBe(512);
  });

  it("reports the exact size of each chunk", () => {
    const size = 20 * MIB + 5;

    expect(getStagingChunkSize(size, 0)).toBe(10 * MIB);
    expect(getStagingChunkSize(size, 1)).toBe(10 * MIB);
    expect(getStagingChunkSize(size, 2)).toBe(5);
  });

  it("maps every part to the chunks it is built from", () => {
    // 単一転送では 1 パートに全チャンクをまとめる。
    expect(getNotionPartChunkIndexes(20 * MIB, 1)).toEqual([0, 1]);
    expect(getNotionPartChunkIndexes(5 * MIB, 1)).toEqual([0]);
    // 分割転送ではチャンクとパートが 1 対 1 で対応する。
    expect(getNotionPartChunkIndexes(20 * MIB + 1, 1)).toEqual([0]);
    expect(getNotionPartChunkIndexes(20 * MIB + 1, 3)).toEqual([2]);
  });

  it("builds the staging path from the save and file ids", () => {
    expect(getNotionStagingChunkPath("save1", "file1", 2)).toBe(
      "notion-staging/save1/file1/2",
    );
  });
});

describe("getNotionTransferredBytes", () => {
  it("counts a whole file once a single part has been sent", () => {
    expect(getNotionTransferredBytes(5 * MIB, 0)).toBe(0);
    expect(getNotionTransferredBytes(5 * MIB, 1)).toBe(5 * MIB);
  });

  it("counts 10 MiB per part for split transfers", () => {
    const size = 25 * MIB;

    expect(getNotionTransferredBytes(size, 1)).toBe(10 * MIB);
    expect(getNotionTransferredBytes(size, 2)).toBe(20 * MIB);
    expect(getNotionTransferredBytes(size, 3)).toBe(size);
  });
});

describe("getNotionFileValidationError", () => {
  it("accepts a file exactly at the workspace limit", () => {
    expect(
      getNotionFileValidationError({ filename: "notes.pdf", size: 5 * MIB }, 5 * MIB),
    ).toBeNull();
  });

  it("rejects a file one byte over the free workspace limit", () => {
    expect(
      getNotionFileValidationError({ filename: "notes.pdf", size: 5 * MIB + 1 }, 5 * MIB),
    ).toContain("larger than");
  });

  it("accepts 5 GiB on a paid workspace and rejects one byte more", () => {
    expect(
      getNotionFileValidationError({ filename: "video.mp4", size: NOTION_MAX_FILE_BYTES }, NOTION_MAX_FILE_BYTES),
    ).toBeNull();
    expect(
      getNotionFileValidationError(
        { filename: "video.mp4", size: NOTION_MAX_FILE_BYTES + 1 },
        NOTION_MAX_FILE_BYTES,
      ),
    ).toContain("larger than");
  });

  it("never accepts more than the Notion limit even on a larger workspace", () => {
    expect(
      getNotionFileValidationError(
        { filename: "video.mp4", size: NOTION_MAX_FILE_BYTES + 1 },
        NOTION_MAX_FILE_BYTES * 4,
      ),
    ).toContain("larger than");
  });

  it("rejects unsupported types and empty files", () => {
    expect(
      getNotionFileValidationError({ filename: "raw.bin", size: 10 }, 5 * MIB),
    ).toContain("does not support");
    expect(
      getNotionFileValidationError({ filename: "noextension", size: 10 }, 5 * MIB),
    ).toContain("does not support");
    expect(getNotionFileValidationError({ filename: "notes.txt", size: 0 }, 5 * MIB)).toContain(
      "empty",
    );
  });
});

describe("format classification", () => {
  it("accepts the documented extensions case-insensitively", () => {
    expect(isSupportedNotionFilename("Report.PDF")).toBe(true);
    expect(isSupportedNotionFilename("notes.md")).toBe(true);
    expect(isSupportedNotionFilename("archive.tar")).toBe(true);
    expect(isSupportedNotionFilename("main.ts")).toBe(true);
    expect(isSupportedNotionFilename("clip.mp4")).toBe(true);
  });

  it("treats only image extensions as images", () => {
    expect(isNotionImageFilename("photo.PNG")).toBe(true);
    expect(isNotionImageFilename("diagram.svg")).toBe(true);
    expect(isNotionImageFilename("clip.mp4")).toBe(false);
    expect(isNotionImageFilename("notes.txt")).toBe(false);
  });
});

describe("formatByteSize", () => {
  it("uses binary units that match the Notion limits", () => {
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(5 * MIB)).toBe("5 MiB");
    expect(formatByteSize(GIB)).toBe("1 GiB");
    expect(formatByteSize(NOTION_MAX_FILE_BYTES)).toBe("5 GiB");
  });
});
