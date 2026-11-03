import { expect, it } from "vitest";
import { prepareCopy, preparePaste, trimLineEnds } from "./clipboard";

it("trims line ends while preserving indentation, interior whitespace and CR/LF forms", () => {
  const value = "  été  😀 \t\r\n\tcode  suivant\t\nfin \rdernier\u00a0";
  expect(trimLineEnds(value)).toBe("  été  😀\r\n\tcode  suivant\nfin\rdernier");
  expect(prepareCopy(value, false)).toBe(value);
  expect(prepareCopy(value, true)).toBe(trimLineEnds(value));
});
it("removes only final newlines when requested, retaining internal lines", () => {
  expect(preparePaste("echo un\r\necho deux\r\n\r\n", { trimPasteWhitespace: false, trimPasteNewlines: true }))
    .toBe("echo un\r\necho deux");
  expect(preparePaste("\n\r\n", { trimPasteWhitespace: true, trimPasteNewlines: true })).toBe("");
});
it("keeps paste cleanup options independent and leaves text untouched by default", () => {
  const value = "  commande  \n  suite\t\n";
  expect(preparePaste(value, { trimPasteWhitespace: false, trimPasteNewlines: false })).toBe(value);
  expect(preparePaste(value, { trimPasteWhitespace: true, trimPasteNewlines: false })).toBe("  commande\n  suite\n");
  expect(preparePaste(value, { trimPasteWhitespace: false, trimPasteNewlines: true })).toBe("  commande  \n  suite\t");
  expect(preparePaste(value, { trimPasteWhitespace: true, trimPasteNewlines: true })).toBe("  commande\n  suite");
});
