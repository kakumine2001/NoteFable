const MAX_SAFE_ERROR_CHARS = 240;

function looksLikeHtml(value: string) {
  // Cloudflare などのエラーページを会話本文へ流さないため、HTML らしい応答を検出する。
  return /<\/?[a-z][\s\S]*>/i.test(value) || /<!doctype\s+html/i.test(value);
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function buildUpstreamErrorMessage(provider: string, status: number, bodyText: string) {
  const compact = compactText(bodyText);

  if (!compact) {
    return `${provider} request failed with HTTP ${status}.`;
  }

  if (looksLikeHtml(compact)) {
    return `${provider} returned an HTML error page. Try again later.`;
  }

  return compact.length > MAX_SAFE_ERROR_CHARS
    ? `${compact.slice(0, MAX_SAFE_ERROR_CHARS)}...`
    : compact;
}

export function sanitizeErrorMessage(error: unknown, fallback = "Request failed.") {
  const message = error instanceof Error ? error.message : fallback;
  return buildUpstreamErrorMessage("Upstream service", 502, message);
}
