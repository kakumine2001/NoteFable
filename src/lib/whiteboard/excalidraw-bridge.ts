// Excalidraw の組み込みの操作（整列・グループ化・重なり順・線の色や太さの変更など）を、NoteFable 自身のツールバーとパネルから実行するための橋渡し。
// ui={false} にすると Excalidraw の既定の画面は出ないが、操作（action）そのものは editor の中に登録されたまま残る。公開 API
// （ExcalidrawImperativeAPI）には操作を実行する口が無いので、キー入力の判定（keyTest）が受け取る editor 本体を一度だけ受け取り、
// その actionManager から名前で操作を実行する。キーの判定は常に false を返す（どのキーの動きも変えない）。
// 固定した Excalidraw の版（package.json の @excalidraw/excalidraw）の内部に依存するので、版を上げたら whiteboard の操作を確かめ直す。

type ActionLike = { name: string };
type ActionManagerLike = {
  actions: Record<string, ActionLike | undefined>;
  executeAction: (action: ActionLike, source?: "ui" | "api" | "keyboard", value?: unknown) => void;
};
// 文字の編集を始める口（App.text.startTextEditing）。Enter キーで図形の文字を編集するときに Excalidraw 自身が呼ぶもの。
export type StartTextEditing = (options: {
  sceneX: number;
  sceneY: number;
  container?: unknown;
  textElement?: unknown;
  initialSelection?: { start: number; end: number };
}) => void;
export type ExcalidrawAppLike = { actionManager: ActionManagerLike; text?: { startTextEditing?: StartTextEditing } };

type RegisterableApi = {
  registerAction: (action: never) => void;
};

// どの物理キーにも当たらない key の値。
export const BRIDGE_KEY = "NoteFableWhiteboardBridge";

export type WhiteboardActions = {
  // 操作を名前で実行する。editor を受け取れていない・その名前の操作が無いときは false。
  run: (name: string, value?: unknown) => boolean;
  has: (name: string) => boolean;
  ready: () => boolean;
  // 図形（container）の文字の編集を始める（思考マップの新しい節）。initialSelection で最初に選んでおく範囲。editor が無ければ false。
  editText: (options: Parameters<StartTextEditing>[0]) => boolean;
};

// api に橋渡しの操作を登録し、container の中でキー入力を 1 回だけ起こして editor を受け取る。
export function connectWhiteboardActions(api: RegisterableApi, container: HTMLElement | null): WhiteboardActions {
  let app: ExcalidrawAppLike | null = null;
  const action = {
    name: "notefableBridge",
    label: "notefableBridge",
    trackEvent: false,
    keyTest: (event: KeyboardEvent, _appState: unknown, _elements: unknown, editor: unknown) => {
      if (!app && isApp(editor)) app = editor;
      return event.key === BRIDGE_KEY && false;
    },
    perform: () => false,
  };
  api.registerAction(action as never);
  const capture = () => {
    if (app || !container) return;
    // Excalidraw はキー入力を自分の要素で受ける（React の onKeyDown）。泡立てて届ける。
    container.dispatchEvent(new KeyboardEvent("keydown", { key: BRIDGE_KEY, bubbles: true, cancelable: true }));
  };
  capture();
  return {
    run(name, value) {
      capture();
      const target = app?.actionManager.actions[name];
      if (!app || !target) return false;
      app.actionManager.executeAction(target, "ui", value ?? null);
      return true;
    },
    has(name) {
      capture();
      return Boolean(app?.actionManager.actions[name]);
    },
    ready() {
      capture();
      return app !== null;
    },
    editText(options) {
      capture();
      const start = app?.text?.startTextEditing;
      if (typeof start !== "function") return false;
      start(options);
      return true;
    },
  };
}

function isApp(value: unknown): value is ExcalidrawAppLike {
  if (typeof value !== "object" || value === null) return false;
  const manager = (value as { actionManager?: unknown }).actionManager;
  return typeof manager === "object" && manager !== null
    && typeof (manager as { executeAction?: unknown }).executeAction === "function"
    && typeof (manager as { actions?: unknown }).actions === "object";
}
