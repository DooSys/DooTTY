import type { IBuffer } from "@xterm/xterm";

export const EXPORT_BYTES = 8 * 1024 * 1024;

/** Export logical lines, joining soft wraps without inventing line breaks. */
export function terminalText(buffer: IBuffer, limit = EXPORT_BYTES): string {
  const chunks: string[] = [];
  const encoder = new TextEncoder();
  let bytes = 0;
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const continues = buffer.getLine(i + 1)?.isWrapped ?? false;
    const text = line.translateToString(!continues) + (continues ? "" : "\n");
    bytes += encoder.encode(text).length;
    if (bytes > limit) throw new Error("EXPORT_TOO_LARGE");
    chunks.push(text);
  }
  return chunks.join("").replace(/\n+$/, "") + "\n";
}

export function multilinePaste(text: string): boolean {
  // A final newline can execute a command too; include it in the confirmation.
  return /[\r\n]/.test(text);
}
