type Edit = {
  // 画面に出したい最新のアイコン。
  desired: string | null;
  // サーバーに保存できたことを確認した最新のアイコン。
  confirmed: string | null;
  running: boolean;
  // この会話のアイコンが最後に動いた（変更開始または確定）時点の通し番号。
  seq: number;
};

// 会話アイコンの保存を会話ごとに直列化し、一覧の再取得や遅れて届く応答で画面の値が戻らないようにする。
export class SessionIconSync {
  private seq = 0;
  private edits = new Map<string, Edit>();

  constructor(private readonly send: (sessionId: string, icon: string | null) => Promise<boolean>) {}

  // 一覧を取りに行く直前に呼ぶ。戻り値を reconcile に渡すと、取得中に起きたアイコン変更を判別できる。
  mark() {
    return this.seq;
  }

  // 取得した一覧に、取得開始以降に動いた（または保存中の）アイコンを重ねる。古い応答で上書きしない。
  reconcile<T extends { id: string; icon?: string | null }>(sessions: T[], startedAt: number): T[] {
    return sessions.map((session) => {
      const edit = this.edits.get(session.id);
      if (!edit || (!edit.running && edit.seq <= startedAt)) return session;
      return { ...session, icon: edit.running ? edit.desired : edit.confirmed };
    });
  }

  // current は今画面に出ているアイコン。show で画面へ反映し、保存に失敗したら元の確定値へ戻して fail を呼ぶ。
  async change(
    sessionId: string,
    icon: string | null,
    current: string | null,
    show: (icon: string | null) => void,
    fail: () => void,
  ) {
    let edit = this.edits.get(sessionId);
    if (!edit) {
      edit = { desired: icon, confirmed: current, running: false, seq: 0 };
      this.edits.set(sessionId, edit);
    }
    // 保存中でなければ、画面の値（別の端末の変更も反映済み）を確定値の基準にする。
    if (!edit.running) edit.confirmed = current;
    edit.desired = icon;
    edit.seq = ++this.seq;
    show(icon);
    // 保存中なら、実行中のループが最後の選択まで送る。古い選択は送らない。
    if (edit.running) return;

    edit.running = true;
    try {
      while (edit.desired !== edit.confirmed) {
        const sending = edit.desired;
        if (await this.send(sessionId, sending)) {
          edit.confirmed = sending;
        } else {
          edit.desired = edit.confirmed;
          show(edit.confirmed);
          fail();
          break;
        }
      }
    } finally {
      edit.running = false;
      edit.seq = ++this.seq;
    }
  }
}
