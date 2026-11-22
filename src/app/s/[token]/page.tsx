import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { PublicNoteUnavailable, PublicNoteView } from "@/components/public-note-view";
import { LOCALE_COOKIE, parsePreference, resolveLocale } from "@/lib/i18n/locale";
import { resolvePublicShare } from "@/lib/note-share-server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

async function requestLocale() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    preference: parsePreference(cookieStore.get(LOCALE_COOKIE)?.value),
    acceptLanguage: headerStore.get("accept-language"),
    country: headerStore.get("x-vercel-ip-country"),
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const resolved = await resolvePublicShare(token);
  const title = resolved ? `${resolved.page.title.trim() || "Untitled"} — NoteFable` : "NoteFable";
  return {
    title,
    robots: { index: false, follow: false },
  };
}

export default async function PublicSharedNotePage({ params }: Props) {
  const [{ token }, locale] = await Promise.all([params, requestLocale()]);
  const resolved = await resolvePublicShare(token);
  if (!resolved) return <PublicNoteUnavailable locale={locale} />;
  return <PublicNoteView data={resolved} locale={locale} />;
}
