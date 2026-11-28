import { createHash, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getCookieSecret } from "@/lib/env";
import { canonicalQuizJson, type ReviewQuiz } from "@/lib/quiz/model";

// POST /api/pages/quiz が生成したクイズであることを証明する署名付きトークン。
// データベースにクイズを保存せずに、回答画面内の「AI の内容を報告」（POST /api/reports）で
// 利用者本人のページから生成された AI 出力であることと、本文が改ざんされていないことを検証する。

export type QuizReportClaims = {
  userId: string;
  pageId: string;
  pageKind: "note" | "slides";
  model: string;
  quizHash: string;
};

const AUDIENCE = "notefable-page-quiz-report";
const key = () => new TextEncoder().encode(getCookieSecret());

export function quizDigest(quiz: ReviewQuiz): string {
  return createHash("sha256").update(canonicalQuizJson(quiz)).digest("hex");
}

export async function issueQuizReportToken(
  userId: string,
  payload: { pageId: string; pageKind: "note" | "slides"; model: string; quiz: ReviewQuiz },
): Promise<string> {
  const claims: QuizReportClaims = {
    userId,
    pageId: payload.pageId,
    pageKind: payload.pageKind,
    model: payload.model.slice(0, 120),
    quizHash: quizDigest(payload.quiz),
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key());
}

export async function verifyQuizReportToken(
  token: unknown,
  userId: string,
  pageId: string,
  quiz: ReviewQuiz,
): Promise<{ pageKind: "note" | "slides"; model: string } | null> {
  if (typeof token !== "string" || !token || token.length > 8_192) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], audience: AUDIENCE });
    const claims = payload as unknown as Partial<QuizReportClaims>;
    if (claims.userId !== userId || claims.pageId !== pageId) return null;
    if (claims.pageKind !== "note" && claims.pageKind !== "slides") return null;
    if (typeof claims.model !== "string" || typeof claims.quizHash !== "string" || !/^[0-9a-f]{64}$/.test(claims.quizHash)) return null;
    const expected = Buffer.from(quizDigest(quiz), "hex");
    const actual = Buffer.from(claims.quizHash, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return { pageKind: claims.pageKind, model: claims.model.slice(0, 120) };
  } catch {
    return null;
  }
}
