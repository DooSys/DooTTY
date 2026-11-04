import { describe, expect, it, vi } from "vitest";
import { allowedWebLink, terminalLinkHandler } from "./terminal-links";

describe("terminal web links", () => {
  it("allows HTTP(S), including local servers and encoded paths", () => {
    for (const url of ["https://github.com/DooSys/DooTTY", "http://localhost:3000/a?q=%C3%A9", "http://[::1]:8080/"]) {
      expect(allowedWebLink(url)).toBe(true);
    }
  });
  it("rejects credentials, control characters, oversized and non-web targets", () => {
    const credentials = new URL("https://example.com");
    credentials.username = "example";
    credentials.password = "example";
    for (const url of ["file:///C:/Windows", "javascript:alert(1)", "ssh://host", "mailto:a@example.com", credentials.href, "https://example.com/\n", "https://example.com/\u0085", "not a url", `https://example.com/${"a".repeat(2048)}`]) {
      expect(allowedWebLink(url)).toBe(false);
    }
  });
  it("opens only intentional Ctrl+left-clicks and validates OSC 8 targets too", () => {
    const open = vi.fn();
    const handler = terminalLinkHandler(open, () => "Ctrl+click", () => undefined);
    const event = (ctrlKey: boolean, button = 0) => ({ ctrlKey, button, preventDefault: vi.fn() }) as unknown as MouseEvent;
    handler.activate(event(false), "https://example.com");
    handler.activate(event(true, 2), "https://example.com");
    handler.activate(event(true), "file:///C:/Windows");
    expect(open).not.toHaveBeenCalled();
    handler.activate(event(true), "https://example.com");
    expect(open).toHaveBeenCalledExactlyOnceWith("https://example.com");
  });
});
