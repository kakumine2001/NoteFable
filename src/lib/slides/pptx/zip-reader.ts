import JSZip from "jszip";
import {
  MAX_PPTX_UNCOMPRESSED_BYTES,
  MAX_PPTX_XML_ENTRY_BYTES,
  MAX_PPTX_ZIP_ENTRIES,
  PPTX_ERROR_MESSAGES,
  PptxImportError,
  type XmlParserLike,
} from "@/lib/slides/pptx/types";

// 安全な PPTX（ZIP + XML）リーダー。
// - 解凍バイト数は ZIP ヘッダーの申告値を信用せず、ストリームで実際に受け取ったバイト数を数えて硬上限で止める。
// - XML は DOMParser に渡す前に <!DOCTYPE / <!ENTITY を弾く。
// - .rels の TargetMode="External" は外部URLとして印を付け、ファイル参照では一切たどらない（fetch もしない）。

/** 単一エントリが個別のバイト上限を超えたときの例外（画像ならその画像だけ非対応扱いにして続行できる）。 */
export class PptxEntryTooLargeError extends Error {
  constructor(message = "ZIP entry exceeds per-entry limit.") {
    super(message);
    this.name = "PptxEntryTooLargeError";
  }
}

export type RelEntry = {
  id: string;
  type: string;
  target: string;
  external: boolean;
  resolvedPath: string | null;
};

type StreamHelperLike = {
  on: (event: string, listener: (...args: unknown[]) => void) => StreamHelperLike;
  pause: () => StreamHelperLike;
  resume: () => StreamHelperLike;
};

type ZipObjectWithStream = JSZip.JSZipObject & {
  internalStream?: (type: "uint8array") => StreamHelperLike;
};

const DTD_OR_ENTITY = /<!(?:DOCTYPE|ENTITY)\b/i;

/** ZIP 内のパスを安全に正規化する。親ディレクトリ脱出（..）や制御文字があれば null。 */
export function normalizeZipPath(raw: string): string | null {
  if (!raw || /[\u0000-\u001f]/.test(raw)) return null;
  const unified = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts: string[] = [];
  for (const segment of unified.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return null;
    parts.push(segment);
  }
  return parts.length ? parts.join("/") : null;
}

/** あるパート（例: ppt/slides/slide1.xml）からの相対 Target（例: ../media/image1.png）を正規化する。 */
export function resolveZipTarget(ownerPartPath: string, target: string): string | null {
  if (!target || /[\u0000-\u001f]/.test(target)) return null;
  // フラグメントやクエリを外す。
  const clean = target.split("#")[0].split("?")[0].replace(/\\/g, "/");
  if (!clean) return null;
  // スキーム付き URL は内部パスではない。
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  if (clean.startsWith("/")) return normalizeZipPath(clean);
  const ownerNorm = ownerPartPath ? (normalizeZipPath(ownerPartPath) ?? "") : "";
  const baseParts = ownerNorm.includes("/") ? ownerNorm.split("/").slice(0, -1) : [];
  for (const segment of clean.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!baseParts.length) return null;
      baseParts.pop();
    } else {
      baseParts.push(segment);
    }
  }
  return baseParts.length ? baseParts.join("/") : null;
}

export function relsPathFor(partPath: string): string {
  if (!partPath) return "_rels/.rels";
  const slash = partPath.lastIndexOf("/");
  if (slash < 0) return `_rels/${partPath}.rels`;
  return `${partPath.slice(0, slash)}/_rels/${partPath.slice(slash + 1)}.rels`;
}

// ---- XML ヘルパー（ブラウザの DOMParser とテスト用の linkedom の両方で同じに動く） ----

export function localName(el: Element): string {
  const raw = el.localName || el.tagName || "";
  const colon = raw.indexOf(":");
  return colon >= 0 ? raw.slice(colon + 1) : raw;
}

export function childElements(node: Element | Document | null | undefined): Element[] {
  if (!node) return [];
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i];
    if (child.nodeType === 1) out.push(child as Element);
  }
  return out;
}

export function findChild(parent: Element | Document | null | undefined, name: string): Element | null {
  if (!parent) return null;
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const child = parent.childNodes[i];
    if (child.nodeType === 1 && localName(child as Element) === name) return child as Element;
  }
  return null;
}

export function findChildren(parent: Element | Document | null | undefined, name: string): Element[] {
  if (!parent) return [];
  const out: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const child = parent.childNodes[i];
    if (child.nodeType === 1 && localName(child as Element) === name) out.push(child as Element);
  }
  return out;
}

export function findDescendant(root: Element | Document | null | undefined, name: string): Element | null {
  if (!root) return null;
  const stack: Element[] = childElements(root).reverse();
  while (stack.length) {
    const el = stack.pop()!;
    if (localName(el) === name) return el;
    const kids = childElements(el);
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return null;
}

export function findDescendants(root: Element | Document | null | undefined, name: string): Element[] {
  if (!root) return [];
  const out: Element[] = [];
  const stack: Element[] = childElements(root).reverse();
  while (stack.length) {
    const el = stack.pop()!;
    if (localName(el) === name) out.push(el);
    const kids = childElements(el);
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return out;
}

export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  return null;
}

/** r:id / r:embed / r:link など名前空間付き属性をローカル名も含めて読む。 */
export function attrLocal(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const prefixed = el.getAttribute(`r:${name}`);
  if (prefixed !== null) return prefixed;
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  const attrs = el.attributes;
  if (!attrs) return null;
  for (let i = 0; i < attrs.length; i += 1) {
    const item = attrs[i];
    const raw = item.localName || item.name;
    const colon = raw.indexOf(":");
    const itemLocal = colon >= 0 ? raw.slice(colon + 1) : raw;
    if (itemLocal === name) return item.value;
  }
  return null;
}

export function numAttr(el: Element | null | undefined, name: string): number | null {
  const raw = attr(el, name);
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function boolAttr(el: Element | null | undefined, name: string): boolean | null {
  const raw = attr(el, name);
  if (raw === null) return null;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return null;
}

export class SafePptxZip {
  private readonly entries = new Map<string, ZipObjectWithStream>();
  private readonly bytesCache = new Map<string, Uint8Array>();
  private readonly oversizedEntries = new Set<string>();
  private readonly xmlCache = new Map<string, Document>();
  private readonly relsCache = new Map<string, Map<string, RelEntry>>();
  private totalUncompressedBytes = 0;

  private constructor(
    private readonly xmlParser: XmlParserLike,
    private readonly maxUncompressedBytes: number,
  ) {}

  static async open(
    data: ArrayBuffer | Uint8Array,
    options: { xmlParser?: XmlParserLike; maxUncompressedBytes?: number } = {},
  ): Promise<SafePptxZip> {
    const parser = options.xmlParser ?? (typeof DOMParser !== "undefined" ? new DOMParser() : null);
    if (!parser) throw new PptxImportError("invalid_archive", PPTX_ERROR_MESSAGES.invalidArchive);
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(data);
    } catch {
      throw new PptxImportError("invalid_archive", PPTX_ERROR_MESSAGES.invalidArchive);
    }
    const reader = new SafePptxZip(parser, options.maxUncompressedBytes ?? MAX_PPTX_UNCOMPRESSED_BYTES);
    let count = 0;
    for (const [rawName, entry] of Object.entries(zip.files)) {
      count += 1;
      if (count > MAX_PPTX_ZIP_ENTRIES) {
        throw new PptxImportError("zip_too_large", PPTX_ERROR_MESSAGES.zipTooLarge);
      }
      if (entry.dir) continue;
      // Zip-Slip 対策：元の名前に ".." の経路脱出があれば拒否する。
      const original = entry.unsafeOriginalName ?? rawName;
      if (original.replace(/\\/g, "/").split("/").includes("..")) {
        throw new PptxImportError("unsafe_archive", PPTX_ERROR_MESSAGES.unsafeArchive);
      }
      const norm = normalizeZipPath(entry.name);
      if (!norm) {
        throw new PptxImportError("unsafe_archive", PPTX_ERROR_MESSAGES.unsafeArchive);
      }
      reader.entries.set(norm.toLowerCase(), entry as ZipObjectWithStream);
    }
    return reader;
  }

  has(path: string): boolean {
    const norm = normalizeZipPath(path);
    return norm ? this.entries.has(norm.toLowerCase()) : false;
  }

  get bytesRead(): number {
    return this.totalUncompressedBytes;
  }

  async readBytes(path: string, maxEntryBytes: number, signal?: AbortSignal): Promise<Uint8Array | null> {
    if (signal?.aborted) throw new PptxImportError("aborted", PPTX_ERROR_MESSAGES.aborted);
    const norm = normalizeZipPath(path);
    if (!norm) return null;
    const key = norm.toLowerCase();
    const cached = this.bytesCache.get(key);
    if (cached) {
      if (cached.byteLength > maxEntryBytes) throw new PptxEntryTooLargeError();
      return cached;
    }
    const oversizedKey = `${key}:${maxEntryBytes}`;
    if (this.oversizedEntries.has(oversizedKey)) throw new PptxEntryTooLargeError();
    const entry = this.entries.get(key);
    if (!entry) return null;

    let bytes: Uint8Array;
    try {
      bytes = await this.decompressWithBudget(entry, maxEntryBytes, signal);
    } catch (error) {
      if (error instanceof PptxEntryTooLargeError) {
        this.oversizedEntries.add(oversizedKey);
      }
      throw error;
    }
    this.bytesCache.set(key, bytes);
    return bytes;
  }

  private decompressWithBudget(entry: ZipObjectWithStream, maxEntryBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (typeof entry.internalStream !== "function") {
      return entry.async("uint8array").then((bytes) => {
        if (this.totalUncompressedBytes + bytes.byteLength > this.maxUncompressedBytes) {
          throw new PptxImportError("zip_too_large", PPTX_ERROR_MESSAGES.zipTooLarge);
        }
        this.totalUncompressedBytes += bytes.byteLength;
        if (bytes.byteLength > maxEntryBytes) {
          throw new PptxEntryTooLargeError();
        }
        return bytes;
      });
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      let settled = false;
      const stream = entry.internalStream!("uint8array");

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        chunks.length = 0;
        try { stream.pause(); } catch { /* noop */ }
        reject(error);
      };

      const onAbort = () => fail(new PptxImportError("aborted", PPTX_ERROR_MESSAGES.aborted));
      signal?.addEventListener("abort", onAbort, { once: true });

      stream
        .on("data", (rawChunk: unknown) => {
          if (settled) return;
          if (signal?.aborted) { fail(new PptxImportError("aborted", PPTX_ERROR_MESSAGES.aborted)); return; }
          const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk as ArrayBuffer);
          entryBytes += chunk.byteLength;
          this.totalUncompressedBytes += chunk.byteLength;
          if (this.totalUncompressedBytes > this.maxUncompressedBytes) {
            signal?.removeEventListener("abort", onAbort);
            fail(new PptxImportError("zip_too_large", PPTX_ERROR_MESSAGES.zipTooLarge));
            return;
          }
          if (entryBytes > maxEntryBytes) {
            signal?.removeEventListener("abort", onAbort);
            fail(new PptxEntryTooLargeError());
            return;
          }
          chunks.push(chunk);
        })
        .on("error", () => {
          signal?.removeEventListener("abort", onAbort);
          fail(new PptxImportError("invalid_archive", PPTX_ERROR_MESSAGES.invalidArchive));
        })
        .on("end", () => {
          signal?.removeEventListener("abort", onAbort);
          if (settled) return;
          settled = true;
          const out = new Uint8Array(entryBytes);
          let offset = 0;
          for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.byteLength;
          }
          resolve(out);
        })
        .resume();
    });
  }

  async readXml(path: string, signal?: AbortSignal): Promise<Document | null> {
    const norm = normalizeZipPath(path);
    if (!norm) return null;
    const key = norm.toLowerCase();
    const cached = this.xmlCache.get(key);
    if (cached) return cached;
    let bytes: Uint8Array | null;
    try {
      bytes = await this.readBytes(norm, MAX_PPTX_XML_ENTRY_BYTES, signal);
    } catch (error) {
      if (error instanceof PptxEntryTooLargeError) {
        throw new PptxImportError("zip_too_large", PPTX_ERROR_MESSAGES.zipTooLarge);
      }
      throw error;
    }
    if (!bytes) return null;
    let text = new TextDecoder("utf-8").decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    // 外部実体参照・DTD は一切解釈しない（XXE / Billion Laughs 対策）。
    if (DTD_OR_ENTITY.test(text)) {
      throw new PptxImportError("unsafe_archive", PPTX_ERROR_MESSAGES.unsafeArchive);
    }
    const doc = this.xmlParser.parseFromString(text, "application/xml");
    const root = doc?.documentElement;
    if (!root || localName(root) === "parsererror" || findDescendant(root, "parsererror")) {
      throw new PptxImportError("invalid_archive", PPTX_ERROR_MESSAGES.invalidArchive);
    }
    this.xmlCache.set(key, doc);
    return doc;
  }

  async readRels(ownerPartPath: string, signal?: AbortSignal): Promise<Map<string, RelEntry>> {
    const relsPath = relsPathFor(ownerPartPath);
    const key = relsPath.toLowerCase();
    const cached = this.relsCache.get(key);
    if (cached) return cached;
    const map = new Map<string, RelEntry>();
    const doc = await this.readXml(relsPath, signal);
    if (doc?.documentElement) {
      for (const rel of findChildren(doc.documentElement, "Relationship")) {
        const id = attr(rel, "Id");
        const type = attr(rel, "Type") ?? "";
        const target = attr(rel, "Target") ?? "";
        if (!id || !target) continue;
        const mode = (attr(rel, "TargetMode") ?? "").trim().toLowerCase();
        const external = mode === "external";
        const resolvedPath = external ? null : resolveZipTarget(ownerPartPath, target);
        map.set(id, { id, type, target, external, resolvedPath });
      }
    }
    this.relsCache.set(key, map);
    return map;
  }
}
