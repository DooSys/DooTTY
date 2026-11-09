import { expect, it } from "vitest";
import type { IBuffer } from "@xterm/xterm";
import { terminalText, multilinePaste } from "./terminal-tools";
const buffer = (lines: { text: string; wrapped?: boolean }[]) =>
  ({
    length: lines.length,
    getLine: (i: number) =>
      lines[i] && {
        isWrapped: !!lines[i].wrapped,
        translateToString: (trim: boolean) =>
          trim ? lines[i].text.trimEnd() : lines[i].text,
      },
  }) as unknown as IBuffer;

it("joins soft wraps, preserving significant spaces, and trims only final empty lines", () => {
  expect(
    terminalText(
      buffer([
        { text: "abc  " },
        { text: "def", wrapped: true },
        { text: "  next  " },
        { text: "" },
      ]),
    ),
  ).toBe("abc  def\n  next\n");
});
it("bounds the exported UTF-8 text without silently truncating it", () => {
  expect(() => terminalText(buffer([{ text: "é" }]), 2)).toThrow(
    "EXPORT_TOO_LARGE",
  );
  expect(terminalText(buffer([{ text: "é" }]), 3)).toBe("é\n");
});
it("identifies multiline pastes including a final newline which can execute a command", () => {
  expect(multilinePaste("echo example")).toBe(false);
  for (const text of ["echo example\n", "a\rb", "a\r\nb"])
    expect(multilinePaste(text)).toBe(true);
});
