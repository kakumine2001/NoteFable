import type { ModelProvider } from "@/lib/models";

type Item = Record<string, unknown>;
type Checkpoint = { version: 1; provider: ModelProvider; model: string; items: Item[]; coveredMessageIds: string[] };

// Provider state remains server-side. The visible transcript is never rewritten.
export function restoreCompaction<T extends { id: string; providerContext?: string | null }>(
  newestFirst: T[], provider: ModelProvider, model: string,
): { history: T[]; items: Item[] } {
  for (let index = 0; index < newestFirst.length; index++) {
    const raw = newestFirst[index].providerContext;
    if (!raw) continue;
    try {
      const value = JSON.parse(raw) as Checkpoint;
      if (value.version !== 1 || value.provider !== provider || value.model !== model || !Array.isArray(value.items) || !value.items.length) continue;
      if (!value.items.every((item) => item && typeof item === "object" && !Array.isArray(item))) continue;
      if (!Array.isArray(value.coveredMessageIds) || !value.coveredMessageIds.every((id) => typeof id === "string")) continue;
      // This checkpoint includes the assistant response it is stored on.
      const covered = new Set([...value.coveredMessageIds, newestFirst[index].id]);
      return { history: newestFirst.filter((message) => !covered.has(message.id)), items: value.items };
    } catch { /* A malformed or incompatible checkpoint falls back to the transcript. */ }
  }
  return { history: newestFirst, items: [] };
}

export function serializeCompaction(provider: ModelProvider, model: string, items: Item[], coveredMessageIds: string[]) {
  return JSON.stringify({ version: 1, provider, model, items, coveredMessageIds } satisfies Checkpoint);
}

// Only finalized items are reusable. A newer compaction replaces its entire prefix.
export class OpenAICompaction {
  private items: Item[] | undefined;
  private completed = false;

  push(event: { type?: string; item?: Item; response?: { output?: Item[] } }) {
    if (event.type === "response.completed") this.completed = true;
    if (event.type === "response.output_item.done" && event.item) {
      if (event.item.type === "compaction") this.items = [event.item];
      else this.items?.push(event.item);
    }
    if (event.type === "response.completed" && Array.isArray(event.response?.output)) {
      const output = event.response.output;
      const index = output.findLastIndex((item) => item.type === "compaction");
      if (index >= 0) this.items = output.slice(index);
    }
  }

  get context() { return this.completed ? this.items : undefined; }
}
