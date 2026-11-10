import type { IBuffer } from "@xterm/xterm";

export const EXPORT_BYTES = 8 * 1024 * 1024;

/** Export logical lines, joining soft wraps without inventing line breaks. */
export function terminalText(buffer: IBuffer, limit = EXPORT_BYTES): string {
  const chunks: string[] = [];
  const encoder = new TextEncoder();
  let bytes = 0, pendingBreaks = 0;
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const next = buffer.getLine(i + 1);
    const continues = next?.isWrapped ?? false;
    // xterm inserts an empty padding cell when a wide glyph wraps at the last
    // column. A real space has a character code and must remain in the export.
    const last = line.getCell?.(line.length - 1);
    const widePadding = continues && next?.getCell?.(0)?.getWidth() === 2 &&
      last?.getCode() === 0 && last.getWidth() === 1;
    const text = line.translateToString(!continues, 0, widePadding ? line.length - 1 : undefined);
    if (text) {
      bytes += pendingBreaks + encoder.encode(text).length;
      if (bytes + 1 > limit) throw new Error("EXPORT_TOO_LARGE");
      chunks.push("\n".repeat(pendingBreaks), text);
      pendingBreaks = 0;
    }
    if (!continues) pendingBreaks++;
  }
  if (bytes + 1 > limit) throw new Error("EXPORT_TOO_LARGE");
  return chunks.join("") + "\n";
}

export function multilinePaste(text: string): boolean {
  // A final newline can execute a command too; include it in the confirmation.
  return /[\r\n]/.test(text);
}
