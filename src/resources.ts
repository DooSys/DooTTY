export const CLIPBOARD_BYTES = 4 * 1024 * 1024;
export const HISTORY_CELLS = 8_000_000;

/** Budget the fixed-size xterm cell arrays globally; glyphs and DOM add overhead. */
export function historyLines(requested: number, dimensions: { cols: number; rows: number }[]): number {
  const columns = dimensions.reduce((sum, size) => sum + size.cols, 0);
  const grid = dimensions.reduce((sum, size) => sum + size.cols * size.rows, 0);
  return columns ? Math.min(requested, Math.max(0, Math.floor((HISTORY_CELLS - grid) / columns))) : requested;
}

export function clipboardFits(text: string): boolean {
  return text.length <= CLIPBOARD_BYTES && new TextEncoder().encode(text).length <= CLIPBOARD_BYTES;
}

/** Coalesce repeated UI refreshes instead of spawning duplicate native work. */
export function singleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
  let current: Promise<T> | null = null;
  return () => current ??= Promise.resolve().then(operation).finally(() => { current = null; });
}
