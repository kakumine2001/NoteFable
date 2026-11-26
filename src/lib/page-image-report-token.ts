import { SignJWT, jwtVerify } from "jose";
import { getCookieSecret } from "@/lib/env";

// POST /api/pages/images が生成した画像であることを証明する署名付きトークン。
// プレビューからの通報（POST /api/reports）で通常のアップロードファイルやプロンプトの偽装を防ぐ。
export type PageImageReportClaims = { userId: string; path: string; prompt: string };

const AUDIENCE = "notefable-page-image-report";
const MAX_PROMPT_CHARS = 4_000;
// Base64url 化しても MAX_REPORT_TOKEN_CHARS（8,192）に収まるよう、JWT 内の prompt は UTF-8 4,000 バイト以内に切る。
const MAX_PROMPT_UTF8_BYTES = 4_000;
const key = () => new TextEncoder().encode(getCookieSecret());

function clipUtf8(text: string, maxBytes: number): string {
  const sliced = text.slice(0, MAX_PROMPT_CHARS);
  if (Buffer.byteLength(sliced, "utf8") <= maxBytes) return sliced;
  let bytes = 0;
  let end = 0;
  for (const ch of sliced) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += ch.length;
  }
  return sliced.slice(0, end);
}

export async function issuePageImageReportToken(userId: string, payload: { path: string; prompt: string }): Promise<string> {
  const claims: PageImageReportClaims = {
    userId,
    path: payload.path,
    prompt: clipUtf8(payload.prompt, MAX_PROMPT_UTF8_BYTES),
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key());
}

export async function verifyPageImageReportToken(token: unknown, userId: string): Promise<{ path: string; prompt: string } | null> {
  if (typeof token !== "string" || !token || token.length > 8192) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], audience: AUDIENCE });
    const claims = payload as unknown as Partial<PageImageReportClaims>;
    if (claims.userId !== userId || typeof claims.path !== "string" || typeof claims.prompt !== "string") return null;
    if (!claims.path.startsWith(`note-files/${userId}/`)) return null;
    return { path: claims.path, prompt: claims.prompt.slice(0, MAX_PROMPT_CHARS) };
  } catch {
    return null;
  }
}
