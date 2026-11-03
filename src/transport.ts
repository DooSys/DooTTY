/** Serialize input (including large pastes) and keep each IPC message bounded. */
import { t } from "./i18n";
export class InputQueue {
  private pending: Uint8Array[] = [];
  private running = false;
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
    for (let i = 0; i < bytes.length; i += 8192) {
      this.pending.push(bytes.slice(i, i + 8192));
    }
    this.buffered += bytes.length;
    void this.drain();
  }

  cancel(): void { this.cancelled = true; this.pending = []; this.buffered = 0; }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.cancelled && this.pending.length) {
        const bytes = this.pending.shift()!;
        await this.send(Array.from(bytes));
        if (!this.cancelled) this.buffered -= bytes.length;
      }
    } catch (error) { const cancelled = this.cancelled; this.cancel(); if (!cancelled) this.fail(error); }
    finally { this.running = false; }
  }
}
