import type { PageSelection } from "@/lib/page-ai/types";

// キャンバスのエディター（ホワイトボード・スライド）と AI パネルをつなぐ選択状態。
// - explicit: 「Ask NoteFable / Ask AI」ボタンから明示的に渡された範囲（ロック中のスライド全体など、自動同期しない対象も含む）。
// - live: キャンバス上でいま選択中の要素・複数スライド。パネルがすでに開いている時や、右下の AI キャラクターを押した時にも自動で添付される。
// - dismissedLiveKey: 送信済みまたは「×」で外した live 選択の鍵。別の要素を選び直すか、選択を外して選び直すまで再添付しない。
export type CanvasAiSelectionState = {
  noteId: string;
  explicit: PageSelection | null;
  live: { key: string; selection: PageSelection } | null;
  dismissedLiveKey: string | null;
  signal: number;
};

export function selectionKey(selection: PageSelection | null): string {
  if (!selection) return "";
  const ids = selection.ids?.length ? [...new Set(selection.ids)].sort().join(",") : "";
  return `${ids}\0${selection.text ?? ""}`;
}

export function applyExplicitSelection(
  current: CanvasAiSelectionState | null,
  noteId: string,
  selection: PageSelection,
): CanvasAiSelectionState {
  const sameNote = current?.noteId === noteId;
  return {
    noteId,
    explicit: selection,
    live: sameNote ? current.live : null,
    // 外した（送った）キャンバス上の選択は、別の対象を明示的に聞いても戻さない。選び直すまで外したまま。
    dismissedLiveKey: sameNote ? current.dismissedLiveKey : null,
    signal: (sameNote ? current.signal : 0) + 1,
  };
}

export function applyLiveSelection(
  current: CanvasAiSelectionState | null,
  noteId: string,
  selection: PageSelection | null,
): CanvasAiSelectionState | null {
  const nextKey = selectionKey(selection);
  const sameNote = current?.noteId === noteId;
  if (!selection || !nextKey) {
    if (!sameNote) return current;
    if (current.live === null && current.dismissedLiveKey === null) return current;
    return { ...current, live: null, dismissedLiveKey: null };
  }
  const prevKey = sameNote ? (current.live?.key ?? "") : "";
  if (sameNote && prevKey === nextKey) return current;
  return {
    noteId,
    // ユーザーがキャンバス上で別の選択へ移ったときは、古い明示選択を新しい選択に譲る。
    explicit: null,
    live: { key: nextKey, selection },
    dismissedLiveKey: null,
    signal: sameNote ? current.signal : 0,
  };
}

export function clearActiveSelection(
  current: CanvasAiSelectionState | null,
  noteId: string,
  expected?: PageSelection | null,
): CanvasAiSelectionState | null {
  if (!current || current.noteId !== noteId) return current;
  if (expected !== undefined) {
    const expectedKey = selectionKey(expected);
    if (!expectedKey) return current;
    const nextExplicit = current.explicit && selectionKey(current.explicit) === expectedKey ? null : current.explicit;
    const nextDismissed = current.live && current.live.key === expectedKey ? current.live.key : current.dismissedLiveKey;
    if (nextExplicit === current.explicit && nextDismissed === current.dismissedLiveKey) return current;
    return {
      ...current,
      explicit: nextExplicit,
      dismissedLiveKey: nextDismissed,
    };
  }
  const liveKey = current.live?.key ?? null;
  if (current.explicit === null && current.dismissedLiveKey === liveKey) return current;
  return {
    ...current,
    explicit: null,
    dismissedLiveKey: liveKey,
  };
}

export function resolveActiveSelection(
  state: CanvasAiSelectionState | null,
  noteId: string | null,
): PageSelection | null {
  if (!state || !noteId || state.noteId !== noteId) return null;
  if (state.explicit) return state.explicit;
  if (state.live && state.live.key !== state.dismissedLiveKey) return state.live.selection;
  return null;
}
