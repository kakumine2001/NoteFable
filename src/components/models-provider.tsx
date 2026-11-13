"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { BUILTIN_REGISTRY, getModelOption as pickModelOption, type ModelOption, type ModelRegistry } from "@/lib/models";
import type { PublicModels } from "@/lib/model-registry";

// 画面は「どのモデルが使えるか」を自分では持たず、サーバーが決めた一覧をここで受け取る
// （サーバーのレイアウトが getModelRegistry() の結果を渡す。環境変数 STUDYMATE_MODELS で増減できる）。
// Provider の外（テストなど）では組み込みの一覧にフォールバックする。
const ModelsContext = createContext<ModelRegistry>(BUILTIN_REGISTRY);

export function ModelsProvider({ models, children }: { models: PublicModels; children: ReactNode }) {
  const registry = useMemo<ModelRegistry>(
    () => ({
      // サーバーが渡すのは画面用の項目だけ。画面で使わない項目（能力フラグ以外）は組み込みの型に合わせて補う。
      options: models.models.map((model) => ({ supportsCompaction: false, supportsPageTools: false, ...model })) as ModelOption[],
      defaultModel: models.defaultModel,
    }),
    [models],
  );
  return <ModelsContext.Provider value={registry}>{children}</ModelsContext.Provider>;
}

export function useModels() {
  const registry = useContext(ModelsContext);
  return {
    options: registry.options,
    defaultModel: registry.defaultModel,
    getModelOption: (id: string) => pickModelOption(id, registry.options),
  };
}
