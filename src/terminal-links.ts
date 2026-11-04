import type { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";

/** Match the native URL policy before dispatching either plain or OSC 8 links. */
export function allowedWebLink(uri: string): boolean {
  if (uri.length > 2048 || /[\u0000-\u001f\u007f-\u009f]/.test(uri)) return false;
  try {
    const url = new URL(uri);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export function terminalLinkHandler(
  open: (uri: string) => void,
  hint: () => string,
  element: () => HTMLElement | undefined,
) {
  return {
    allowNonHttpProtocols: false,
    activate: (event: MouseEvent, uri: string) => {
      // A plain click still selects text. Terminal output never opens a browser alone.
      if (!event.ctrlKey || event.button !== 0 || !allowedWebLink(uri)) return;
      event.preventDefault();
      open(uri);
    },
    hover: (_event: MouseEvent, uri: string) => {
      const target = element();
      if (target && allowedWebLink(uri)) target.title = hint();
    },
    leave: () => element()?.removeAttribute("title"),
  };
}

export function installTerminalLinks(terminal: Terminal, open: (uri: string) => void, hint: () => string): void {
  const handler = terminalLinkHandler(open, hint, () => terminal.element);
  terminal.options.linkHandler = handler;
  // xterm disposes loaded addons together with their terminal/tab.
  terminal.loadAddon(new WebLinksAddon(handler.activate, handler));
}
