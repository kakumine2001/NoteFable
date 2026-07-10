export function consumeSseData(text: string, flush = false) {
  const lines = text.split(/\r?\n/);
  const remainder = flush ? "" : (lines.pop() ?? "");
  const data: string[] = [];

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;

    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;

    data.push(payload);
  }

  return { data, remainder };
}
