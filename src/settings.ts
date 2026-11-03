import type { ITheme } from "@xterm/xterm";
import { t, currentLanguage } from "./i18n";
export type Appearance = {
  fontFamily: string;
  fontSize: number;
  theme: string;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
  scrollback: number;
};
export type Config = {
  language: string;
  monitoringEnabled: boolean;
  distribution: string;
  username: string | null;
  directory: string;
  appearance: Appearance;
  interaction: {
    copyOnSelect: boolean; rightClickPaste: boolean;
    trimCopyWhitespace: boolean; trimPasteWhitespace: boolean; trimPasteNewlines: boolean;
    rectangularSelection: boolean; warnOnClose: boolean;
  };
  wslSettingsPath: string;
};
export type LaunchProfile = Pick<
  Config,
  "distribution" | "username" | "directory"
>;
export function createProfile(
  config: Config,
  distribution = config.distribution,
): LaunchProfile {
  return distribution === config.distribution
    ? { distribution, username: config.username, directory: config.directory }
    : { distribution, username: null, directory: "~" };
}
export type Distribution = {
  name: string;
  version: number | null;
  basePath: string;
  vhdPath: string | null;
  fileBytes: number | null;
  isDefault?: boolean;
};
export const defaults: Config = {
  language: "fr",
  monitoringEnabled: true,
  distribution: "Debian",
  username: null,
  directory: "~",
  appearance: {
    fontFamily: "Cascadia Mono, Consolas, monospace",
    fontSize: 14,
    theme: "campbell",
    cursorStyle: "bar",
    cursorBlink: true,
    scrollback: 10000,
  },
  interaction: {
    copyOnSelect: false, rightClickPaste: false,
    trimCopyWhitespace: false, trimPasteWhitespace: false, trimPasteNewlines: false,
    rectangularSelection: false, warnOnClose: true,
  },
  wslSettingsPath: "C:\\Program Files\\WSL\\wslsettings\\wslsettings.exe",
};
export const themes: Record<string, ITheme> = {
  darkPlus: {
    foreground: "#cccccc",
    background: "#1e1e1e",
    selectionBackground: "#264f78",
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightCyan: "#29b8db",
    brightWhite: "#e5e5e5",
    cursor: "#808080",
    magenta: "#bc3fbc",
    brightMagenta: "#d670d6",
  },
  solarizedDark: {
    foreground: "#839496",
    background: "#002B36",
    black: "#002B36",
    red: "#DC322F",
    green: "#859900",
    yellow: "#B58900",
    blue: "#268BD2",
    cyan: "#2AA198",
    white: "#EEE8D5",
    brightBlack: "#073642",
    brightRed: "#CB4B16",
    brightGreen: "#586E75",
    brightYellow: "#657B83",
    brightBlue: "#839496",
    brightCyan: "#93A1A1",
    brightWhite: "#FDF6E3",
    cursor: "#FFFFFF",
    selectionBackground: "#264f78",
    magenta: "#D33682",
    brightMagenta: "#6C71C4",
  },
  campbell: {
    background: "#0c0c0c",
    foreground: "#cccccc",
    cursor: "#ffffff",
    selectionBackground: "#264f78",
    black: "#0c0c0c",
    red: "#c50f1f",
    green: "#13a10e",
    yellow: "#c19c00",
    blue: "#0037da",
    magenta: "#881798",
    cyan: "#3a96dd",
    white: "#cccccc",
    brightBlack: "#767676",
    brightRed: "#e74856",
    brightGreen: "#16c60c",
    brightYellow: "#f9f1a5",
    brightBlue: "#3b78ff",
    brightMagenta: "#b4009e",
    brightCyan: "#61d6d6",
    brightWhite: "#f2f2f2",
  },
  oneHalfDark: {
    background: "#282c34",
    foreground: "#dcdfe4",
    cursor: "#a3b3c3",
    selectionBackground: "#454d5c",
    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#dcdfe4",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#fafafa",
    foreground: "#383a42",
    cursor: "#383a42",
    selectionBackground: "#c6d7f0",
    black: "#383a42",
    red: "#a62632",
    green: "#508000",
    yellow: "#986801",
    blue: "#145ca8",
    magenta: "#a03e9e",
    cyan: "#007e8a",
    white: "#d0d0d0",
    brightBlack: "#696c77",
    brightRed: "#a62632",
    brightGreen: "#508000",
    brightYellow: "#986801",
    brightBlue: "#145ca8",
    brightMagenta: "#a03e9e",
    brightCyan: "#007e8a",
    brightWhite: "#ffffff",
  },
};
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return t("storage.sizeUnavailable");
  if (bytes < 1024) return t("storage.bytes", { value: bytes });
  const units = ["storage.unitKiB", "storage.unitMiB", "storage.unitGiB", "storage.unitTiB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toLocaleString(currentLanguage(), { maximumFractionDigits: 2 })} ${t(units[index])}`;
}
