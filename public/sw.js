// NoteFable の Service Worker。ページや API はキャッシュしない。
// やることは 1 つだけ：インストールした PWA がシステムの「共有」から受け取った POST /share-target を預かり、/app?share=<id> へ送る。
// 預かった中身（文・ファイル）は Cache Storage に置き、アプリ側（src/lib/share-target.ts）が 1 度だけ取り出して消す。
const SHARE_CACHE = "notefable-share-v1";
const SHARE_PREFIX = "/__notefable_share__/";
const MAX_FILES = 20;
// これより大きいファイルは中身を預けず、本当の大きさだけ記録する（アプリ側が「大きすぎる」と正しく断れる）。
const MAX_STORED_BYTES = 25 * 1024 * 1024;
const MAX_AGE_MS = 10 * 60 * 1000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "POST") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname !== "/share-target") return;
  event.respondWith(handleShare(request));
});

async function handleShare(request) {
  try {
    const form = await request.formData();
    const text = (key) => (typeof form.get(key) === "string" ? form.get(key) : "");
    const picked = form.getAll("files").filter((value) => typeof value !== "string").slice(0, MAX_FILES);
    const id = crypto.randomUUID();
    const cache = await caches.open(SHARE_CACHE);
    await prune(cache);
    const files = [];
    for (let index = 0; index < picked.length; index += 1) {
      const file = picked[index];
      const truncated = file.size > MAX_STORED_BYTES;
      await cache.put(`${SHARE_PREFIX}${id}/file-${index}`, new Response(truncated ? new Blob([]) : file));
      files.push({ index, name: file.name, type: file.type, size: file.size, truncated });
    }
    const meta = { createdAt: Date.now(), title: text("title"), text: text("text"), url: text("url"), files };
    await cache.put(`${SHARE_PREFIX}${id}/meta.json`, new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
    return Response.redirect(`/app?share=${encodeURIComponent(id)}`, 303);
  } catch {
    return Response.redirect("/app", 303);
  }
}

// 10 分以上前に預かったまま使われなかったものを捨てる。
async function prune(cache) {
  const now = Date.now();
  for (const key of await cache.keys()) {
    if (!key.url.endsWith("/meta.json")) continue;
    const response = await cache.match(key);
    const meta = response ? await response.json().catch(() => null) : null;
    if (meta && now - meta.createdAt < MAX_AGE_MS) continue;
    const prefix = key.url.slice(0, -"meta.json".length);
    for (const other of await cache.keys()) if (other.url.startsWith(prefix)) await cache.delete(other);
  }
}
