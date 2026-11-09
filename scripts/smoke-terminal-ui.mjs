/** Exercise the production frontend with simulated IPC; never starts WSL or saves user files. */
import { chromium } from "playwright";
import { preview } from "vite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const defaults = JSON.parse(
  readFileSync(new URL("../config.example.json", import.meta.url), "utf8"),
);
const server = await preview({
  preview: { host: "127.0.0.1", port: 1423, strictPort: true },
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1250, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((defaults) => {
    window.isTauri = true;
    window.calls = [];
    window.sessions = {};
    window.next = 0;
    window.clipboardText = "example";
    let callback = 0;
    window.callbacks = {};
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: (handler) => {
        const id = ++callback;
        window.callbacks[id] = handler;
        return id;
      },
      unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        window.calls.push({ command, args });
        if (command === "plugin:event|listen") return args.handler;
        if (command === "session_config")
          return JSON.parse(
            localStorage.getItem("mock-config") ??
              JSON.stringify({ ...defaults, monitoringEnabled: false }),
          );
        if (command === "save_config") {
          localStorage.setItem("mock-config", JSON.stringify(args.config));
          // Native serde responses need not retain the form's object key order.
          return JSON.parse(JSON.stringify(args.config, (_key, value) =>
            value !== null && typeof value === "object" && !Array.isArray(value)
              ? Object.fromEntries(Object.entries(value).reverse())
              : value,
          ));
        }
        if (command === "start_session") {
          const id = ++window.next;
          window.sessions[id] = args.output;
          args.output.onmessage({
            kind: "data",
            bytes: Array.from(
              new TextEncoder().encode(
                `\x1b]0;Linux session ${id}\x07developer@linux-host:~$ SESSION-${id}\r\n\x1b[?2004h`,
              ),
            ),
          });
          return id;
        }
        if (command === "clipboard_read") return window.clipboardText;
        if (command === "clipboard_write") {
          window.clipboardText = args.text;
          return;
        }
        if (command === "close_session") {
          delete window.sessions[args.sessionId];
          return;
        }
        if (command === "export_terminal_text") return true;
        if (command === "list_distributions")
          return [
            {
              name: "Debian",
              version: 2,
              isDefault: true,
              basePath: "D:\\WSL\\Debian",
              vhdPath: null,
              fileBytes: null,
            },
            {
              name: "Ubuntu",
              version: 2,
              basePath: "D:\\WSL\\Ubuntu",
              vhdPath: null,
              fileBytes: null,
            },
          ];
        if (command === "list_terminal_fonts")
          return ["Consolas", "Cascadia Mono"];
        if (command === "wsl_config_info")
          return { path: "C:\\Users\\developer\\.wslconfig", exists: true };
        if (command === "wsl_system_info")
          return {
            version: "3.0.3.0",
            details: "WSL 3.0.3.0",
            status: "WSL 2",
            statusError: null,
          };
        if (command === "wsl_latest_release")
          return {
            tag: "3.0.3",
            version: "3.0.3",
            publishedAt: "2026-10-09T18:21:40Z",
            url: "https://github.com/microsoft/WSL/releases/tag/3.0.3",
          };
        if (command === "wsl_overview") return { running: ["Debian"] };
        return null;
      },
    };
  }, defaults);
  await page.goto("http://127.0.0.1:1423");
  await page.locator('.session-tab[data-state="connected"]').waitFor();
  await page.locator("#settings-toggle").click();
  await page.waitForFunction(() => document.querySelector("#save-settings").disabled);
  assert(await page.locator("#discard-settings").isDisabled());
  await page.locator("#config-warn-paste").check();
  assert(await page.locator("#save-settings").isEnabled());
  await page.locator("#config-warn-paste").uncheck();
  assert(await page.locator("#save-settings").isDisabled());
  await page.locator("#profile-add").click();
  await page.locator("#profile-name").fill("Developer");
  await page.locator("#profile-user").fill("developer");
  await page.locator("#profile-directory").fill("/home/developer/project one");
  await page.locator("#profile-distribution-button").click();
  await page
    .locator("#profile-distribution-options [role=option]")
    .filter({ hasText: "Debian" })
    .click();
  await page.locator("#profile-editor button[value=accept]").click();
  assert.equal(await page.locator("#profiles-list .profile-card").count(), 1);
  await page.locator("#config-default-profile-button").click();
  await page
    .locator("#config-default-profile-options [role=option]")
    .filter({ hasText: "Developer" })
    .click();
  await page.locator("#config-warn-paste").check();
  await page.locator("#save-settings").click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("mock-config") ?? "{}").profiles
        ?.length === 1,
  );
  await page.waitForFunction(() => document.querySelector("#save-settings").disabled);
  assert(await page.locator("#discard-settings").isDisabled());
  await page.locator("#config-warn-paste").uncheck();
  assert(await page.locator("#save-settings").isEnabled());
  await page.locator("#discard-settings").click();
  assert(await page.locator("#save-settings").isDisabled());
  assert(await page.locator("#config-warn-paste").isChecked());
  await page.locator("#new-tab").click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".session-tab[data-state=connected]").length ===
      2,
  );
  assert.equal(
    await page.locator(".session-tab.active .tab-title").innerText(),
    "Developer",
  );
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.calls.filter((c) => c.command === "start_session").at(-1).args
          .profile,
    ),
    {
      distribution: "Debian",
      username: "developer",
      directory: "/home/developer/project one",
    },
  );
  const context = async (action) => {
    await page
      .locator(".session-tab.active .tab-select")
      .click({ button: "right" });
    await page.locator(`#tab-context-menu [data-action=${action}]`).click();
  };
  await context("rename");
  await page.locator("#tab-name").fill("Renamed <b>");
  await page.locator("#tab-name").press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector(".session-tab.active .tab-title").textContent ===
      "Renamed <b>",
  );
  assert.equal(
    await page.locator(".session-tab.active .tab-title").innerText(),
    "Renamed <b>",
  );
  await context("duplicate");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".session-tab[data-state=connected]").length ===
      3,
  );
  assert.equal(
    await page.locator(".session-tab.active .tab-title").innerText(),
    "Renamed <b>",
  );
  const writes = () =>
    page.evaluate(
      () => window.calls.filter((c) => c.command === "write_session").length,
    );
  await context("readOnly");
  let before = await writes();
  await page.keyboard.type("blocked");
  await page.keyboard.press("Control+Shift+V");
  await page.waitForTimeout(80);
  assert.equal(await writes(), before);
  await page.evaluate(() =>
    window.sessions[3].onmessage({
      kind: "data",
      bytes: Array.from(new TextEncoder().encode("READONLY OUTPUT\r\n")),
    }),
  );
  await page.waitForTimeout(40);
  assert.match(
    await page.locator(".session-tab.active").getAttribute("class"),
    /read-only/,
  );
  await page.keyboard.press("Control+Shift+A");
  await page.keyboard.press("Control+Shift+C");
  await page.waitForTimeout(30);
  assert.match(
    await page.evaluate(() => window.clipboardText),
    /READONLY OUTPUT/,
  );
  await context("readOnly");
  await page
    .locator(".terminal-pane:not([hidden]) .xterm-helper-textarea")
    .focus();
  await page.keyboard.type("ok");
  await page.waitForTimeout(50);
  assert((await writes()) > before);
  await page.evaluate(() => (window.clipboardText = "<tag>\n" + "x".repeat(5000) + "second"));
  before = await writes();
  await page.keyboard.press("Control+Shift+V");
  await page.locator("#paste-dialog").waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#paste-preview").inputValue(),
    "<tag>\n" + "x".repeat(5000) + "second",
  );
  assert.equal(await writes(), before);
  const pasteCancelled = page
    .locator("#paste-dialog")
    .evaluate(
      (dialog) =>
        new Promise((resolve) =>
          dialog.addEventListener("close", () => resolve(true), { once: true }),
        ),
    );
  await page.locator("#paste-preview").fill("cancelled edit\n");
  await page.locator("#paste-dialog button[value=cancel]").click();
  await pasteCancelled;
  assert.equal(await writes(), before);
  await page.keyboard.press("Control+Shift+V");
  assert.equal(await page.locator("#paste-preview").inputValue(), "<tag>\n" + "x".repeat(5000) + "second");
  await page.locator("#paste-preview").fill("echo changed-parameter");
  await page.locator("#paste-preview").press("End");
  await page.locator("#paste-preview").press("Enter");
  assert(await page.locator("#paste-dialog").isVisible());
  assert.equal(await writes(), before);
  await page.locator("#paste-dialog button[value=accept]").click();
  await page.waitForFunction(
    (count) =>
      window.calls.filter((c) => c.command === "write_session").length > count,
    before,
  );
  assert((await writes()) > before);
  const sentPaste = await page.evaluate((count) => new TextDecoder().decode(new Uint8Array(
    window.calls.filter(c => c.command === "write_session").slice(count).flatMap(c => c.args.bytes),
  )), before);
  assert.equal(sentPaste, "\x1b[200~echo changed-parameter\r\x1b[201~");
  assert.equal(await page.locator("#paste-preview").inputValue(), "");
  const palette = async (text) => {
    await page.keyboard.press("Control+Shift+P");
    await page.locator("#command-query").fill(text);
  };
  await palette("export");
  await page.locator("#command-query").press("Enter");
  await page.waitForFunction(() =>
    window.calls.some((c) => c.command === "export_terminal_text"),
  );
  assert.match(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.command === "export_terminal_text").args
          .text,
    ),
    /READONLY OUTPUT/,
  );
  await page.keyboard.press("Control+Shift+F");
  await page.locator("#query").fill("READONLY OUTPUT");
  await page.locator("#query").press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        ".terminal-pane:not([hidden]) .xterm-selection div",
      ).length > 0,
  );
  assert(
    (await page
      .locator(".terminal-pane:not([hidden]) .xterm-selection div")
      .count()) > 0,
  );
  await palette("effacer");
  await page.locator("#command-query").press("Enter");
  await page.waitForTimeout(50);
  assert.doesNotMatch(
    await page.locator(".terminal-pane:not([hidden]) .xterm-rows").innerText(),
    /READONLY OUTPUT/,
  );
  await page.locator("#query").press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        ".terminal-pane:not([hidden]) .xterm-selection div",
      ).length === 0,
  );
  assert.equal(
    await page
      .locator(".terminal-pane:not([hidden]) .xterm-selection div")
      .count(),
    0,
  );
  await context("closeOthers");
  await page.locator("#close-others-dialog button[value=cancel]").click();
  assert.equal(
    await page.locator(".session-tab:not(.settings-tab)").count(),
    3,
  );
  await context("closeOthers");
  await page.locator("#close-others-dialog button[value=accept]").click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".session-tab:not(.settings-tab)").length === 1,
  );
  assert.equal(
    await page.locator(".session-tab:not(.settings-tab)").count(),
    1,
  );
  // A confirmation must not send the paste to a replacement tab/session.
  await page.locator("#new-tab").click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".session-tab[data-state=connected]").length ===
      2,
  );
  before = await writes();
  await page.evaluate(() => (window.clipboardText = "stale paste\n"));
  await page.keyboard.press("Control+Shift+V");
  await page.locator("#paste-dialog").waitFor({ state: "visible" });
  await page.evaluate(() =>
    document.querySelector(".session-tab.active .tab-close").click(),
  );
  await page.locator("#paste-dialog button[value=accept]").click();
  await page.waitForTimeout(30);
  assert.equal(await writes(), before);
  await page.reload();
  await page.locator(".session-tab[data-state=connected]").waitFor();
  assert.equal(
    await page.locator(".session-tab.active .tab-title").innerText(),
    "Developer",
  );
  await page.locator("#settings-toggle").click();
  assert.equal(await page.locator("#profiles-list .profile-card").count(), 1);
  await page
    .locator("#profiles-list button")
    .filter({ hasText: "Supprimer" })
    .click();
  await page.locator("#save-settings").click();
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem("mock-config")).profiles.length === 0,
  );
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("mock-config")).defaultProfileId,
    ),
    null,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: profile CRUD/default/persistence, modal combo, tab rename/duplicate, read-only input/paste blocking and live output/copy, editable full paste preview/cancel/confirm, settings save state, palette, export, clear and close-others confirmation.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
