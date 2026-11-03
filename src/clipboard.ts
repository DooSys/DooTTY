/** Trim line ends without changing indentation, interior spaces or line endings. */
export function trimLineEnds(text: string): string {
  return text.replace(/[^\S\r\n]+(?=\r\n|\r|\n|$)/g, "");
}

export function prepareCopy(text: string, trimWhitespace: boolean): string {
  return trimWhitespace ? trimLineEnds(text) : text;
}

export function preparePaste(text: string, options: { trimPasteWhitespace: boolean; trimPasteNewlines: boolean }): string {
  const result = options.trimPasteWhitespace ? trimLineEnds(text) : text;
  return options.trimPasteNewlines ? result.replace(/[\r\n]+$/, "") : result;
}
