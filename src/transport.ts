/** Serialize input (including large pastes) and keep each IPC message bounded. */
import { t } from "./i18n";
export class InputQueue {
  private pending: Uint8Array[] = [];
  private running = false;
  private draining: Promise<void> = Promise.resolve();
  private closePaste = false;
  private pasteOpen = false;
  private cancelled = false;
  private buffered = 0;

  constructor(
    private send: (bytes: number[]) => Promise<void>,
    private fail: (error: unknown) => void,
    private limit = 4 * 1024 * 1024,
  ) {}

  push(bytes: Uint8Array): void {
    if (this.cancelled) return;
    if (this.buffered + bytes.length > this.limit) {
      this.fail(new Error(t("input.tooLarge")));
      return;
    }
    for (let i = 0; i < bytes.length;) {
      let end = Math.min(i + 8192, bytes.length);
      // A cancellation must never leave half of a bracketed-paste delimiter.
      for (let start = Math.max(i, end - 5); start < end; start++) {
        if (bytes[start] === 27 && bytes[start + 1] === 91 && bytes[start + 2] === 50 &&
            bytes[start + 3] === 48 && [48, 49].includes(bytes[start + 4]) &&
            bytes[start + 5] === 126 && start + 6 > end) {
          end = start;
          break;
        }
      }
      this.pending.push(bytes.slice(i, end));
      i = end;
    }
    this.buffered += bytes.length;
    if (!this.running) this.draining = this.drain();
  }

  cancel(closePaste = false): Promise<void> {
    this.closePaste ||= closePaste;
    this.cancelled = true;
    this.pending = [];
    this.buffered = 0;
    return this.draining;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.cancelled && this.pending.length) {
        const bytes = this.pending.shift()!;
        await this.send(Array.from(bytes));
        for (let i = 0; i + 5 < bytes.length; i++) {
          if (bytes[i] === 27 && bytes[i+1] === 91 && bytes[i+2] === 50 &&
              bytes[i+3] === 48 && [48,49].includes(bytes[i+4]) && bytes[i+5] === 126)
            this.pasteOpen = bytes[i+4] === 48;
        }
        if (!this.cancelled) this.buffered -= bytes.length;
      }
      if (this.closePaste && this.pasteOpen) {
        await this.send([27, 91, 50, 48, 49, 126]);
        this.pasteOpen = false;
      }
    } catch (error) { const cancelled = this.cancelled; this.cancel(); if (!cancelled) this.fail(error); }
    finally { this.running = false; }
  }
}
