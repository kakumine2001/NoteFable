import { registerCanvasFlusher } from "@/lib/canvas-flush";

const DEFAULT_UPLOAD_FLUSH_WAIT_MS = 10_000;

const pendingSlideUploads = new Map<string, Set<Promise<void>>>();
const pendingSlideUploadFlushers = new Map<string, () => void>();

// ページ単位で進行中の画像アップロードを追跡する。
// スライドエディターがアンマウントされてから再開・自動適用・削除が起きても、
// 完了まで Trash / Proposal の flush が待てるようにモジュール単位で flusher を保持する。
export function trackSlideUpload(
  pageId: string,
  task: Promise<void>,
  waitMs = DEFAULT_UPLOAD_FLUSH_WAIT_MS,
): Promise<void> {
  let set = pendingSlideUploads.get(pageId);
  if (!set) {
    set = new Set();
    pendingSlideUploads.set(pageId, set);
    const unregister = registerCanvasFlusher(
      async () => {
        const deadline = Date.now() + waitMs;
        while (true) {
          const tasks = pendingSlideUploads.get(pageId);
          if (!tasks?.size) return true;
          const remaining = deadline - Date.now();
          if (remaining <= 0) return false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            Promise.allSettled([...tasks]),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, remaining); }),
          ]);
          clearTimeout(timer);
          if ((pendingSlideUploads.get(pageId)?.size ?? 0) === 0) return true;
          if (Date.now() >= deadline) return false;
        }
      },
      () => (pendingSlideUploads.get(pageId)?.size ?? 0) > 0,
      pageId,
    );
    pendingSlideUploadFlushers.set(pageId, unregister);
  }

  const tracked = Promise.resolve(task).finally(() => {
    const currentSet = pendingSlideUploads.get(pageId);
    if (!currentSet) return;
    currentSet.delete(tracked);
    if (!currentSet.size) {
      pendingSlideUploads.delete(pageId);
      pendingSlideUploadFlushers.get(pageId)?.();
      pendingSlideUploadFlushers.delete(pageId);
    }
  });
  void tracked.catch(() => undefined);
  set.add(tracked);
  return tracked;
}
