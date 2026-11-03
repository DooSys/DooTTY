/** Incremental decoding for WSL's redirected UTF-8 or UTF-16LE output. */
export class OutputDecoder {
  private prefix: number[] = [];
  private decoder: TextDecoder | null = null;
  decode(bytes: number[], final = false): string {
    if (!this.decoder) {
      this.prefix.push(...bytes);
      if (!final && this.prefix.length < 64 && !this.prefix.includes(0) && !(this.prefix[0] === 0xff && this.prefix[1] === 0xfe)) return "";
      this.decoder = new TextDecoder(this.prefix.includes(0) || (this.prefix[0] === 0xff && this.prefix[1] === 0xfe) ? "utf-16le" : "utf-8");
      bytes = this.prefix;
      this.prefix = [];
    }
    return this.decoder.decode(Uint8Array.from(bytes), { stream: !final });
  }
}
