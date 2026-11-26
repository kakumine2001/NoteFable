import { SignJWT, jwtVerify } from "jose";
import { getCookieSecret } from "@/lib/env";

// POST /api/pages/images が生成した画像であることを証明する署名付きトークン。
// プレビューからの通報（POST /api/reports）で通常のアップロードファイルやプロンプトの偽装を防ぐ。
export type PageImageReportClaims = { userId: string; path: string; prompt: string };

const AUDIENCE = "notefable-page-image-report";
const MAX_PROMPT_CHARS = 4_000;
const key = () => new TextEncoder().encode(getCookieSecret());

export async function issuePageImageReportToken(userId: string, payload: { path: string; prompt: string }): Promise<string> {
  const claims: PageImageReportClaims = {
    userId,
    path: payload.path,
    prompt: payload.prompt.slice(0, MAX_PROMPT_CHARS),
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
