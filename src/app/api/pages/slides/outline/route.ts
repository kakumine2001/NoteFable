import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { msg } from "@/lib/i18n/translate";
import { outlineInput, outlineInstructions, parseOutlineReply } from "@/lib/slides/ai-prompt";
import { generateSlidesText, readSlidesMaterial, readSlidesRequest, SLIDES_FAILED, slidesModel } from "@/lib/slides/ai-server";
import { clientNetworkKey, consumeUsage, refundUsage, usageLimitResponse, type UsageTicket } from "@/lib/usage-limits";
import { abandonUsageRequest, claimUsageRequest, completeUsageRequest, releaseUsageRequest, type UsageRequestClaim } from "@/lib/usage-requests";

export const runtime = "nodejs";
// 1 回の生成を待つ。上流の要求は PAGE_TIMEOUT_MS で先に打ち切る。
export const maxDuration = 300;

const MAX_OUTLINE_OUTPUT_TOKENS = 16_000;

// 端末に置くウィザードの下書きを利用者ごとに分けるための値（画面は利用者の ID を持たない。未ログインの利用者もいる）。
export async function GET() {
  try {
    const user = await getOrCreateUser();
    const scope = createHash("sha256").update(`notefable:slides-draft:v1:${user.id}`).digest("base64url").slice(0, 22);
    return NextResponse.json({ scope }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to read the slides draft scope", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: msg("Database is unavailable. Try again in a moment.") }, { status: 503 });
  }
}

// スライドの大綱を AI が考える。ページは作らない（docs/architecture/slides.md の「AI 生成幻灯片」）。
// body: { source, options, model?, clientRequestId } → 200 { outline, partial? }（partial: 材料を上限で切った）
// 送信 1 回分（chat）として数え、返せなかったときは戻す。同じ clientRequestId と同じ入力の送り直しは数え直さない（usage-requests.ts）。
export async function POST(request: Request) {
  const parsed = await readSlidesRequest(request);
  if (parsed instanceof Response) return parsed;
  const { body, source, options, clientRequestId } = parsed;

  let ticket: UsageTicket | undefined;
  let claim: Exclude<UsageRequestClaim, { state: "busy" }> | undefined;
  // 返せなかったとき：この呼び出しが数えたなら戻して印を消す。数えた処理が消えたあとの続き（resume）は、また続けられるようにする。
  const giveUp = async () => {
    await refundUsage(ticket);
    ticket = undefined;
    if (claim?.state === "new") await releaseUsageRequest(claim);
    else if (claim?.state === "resume") await abandonUsageRequest(claim);
    claim = undefined;
  };
  try {
    const user = await getOrCreateUser();
    const material = await readSlidesMaterial(user.id, source);
    if (material instanceof Response) return material;
    const model = slidesModel(body.model);

    const claimed = await claimUsageRequest(user.id, "slides-outline", clientRequestId, { source, options, model: model.id });
    if (claimed.state === "busy") {
      return NextResponse.json({ error: msg("This request is still running. Try again in a moment."), code: "request_in_progress" }, { status: 409 });
    }
    claim = claimed;
    if (claim.state === "new") {
      const usage = await consumeUsage(user, "chat", clientNetworkKey(request));
      if (!usage.ok) {
        await giveUp();
        return usageLimitResponse(usage, "chat");
      }
      ticket = usage.ticket;
    }

    const reply = await generateSlidesText({
      model,
      instructions: outlineInstructions(source.type),
      input: outlineInput(material.text, options, source.type),
      userId: user.id,
      request,
      maxOutputTokens: MAX_OUTLINE_OUTPUT_TOKENS,
    });
    const outline = reply === null ? null : parseOutlineReply(reply, material.title);
    if (!outline) {
      await giveUp();
      return NextResponse.json({ error: SLIDES_FAILED }, { status: 502 });
    }
    await completeUsageRequest(claim);
    return NextResponse.json({ outline, ...(material.truncated ? { partial: true } : {}) });
  } catch (error) {
    await giveUp();
    console.error("Slides outline request failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: SLIDES_FAILED }, { status: 503 });
  }
}
