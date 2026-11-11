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
    window.launchProfiles = {};
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
              JSON.stringify(defaults),
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
          window.launchProfiles[id] = args.profile;
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
        if (command === "monitoring_snapshot" && window.stoppedSession === args.sessionId)
          throw new Error("MONITOR_DISTRIBUTION_STOPPED");
        if (command === "write_session" && window.failedInput === args.sessionId)
          throw new Error("Session closed");
        if (command === "monitoring_snapshot") return {
          cpuTotal:1000,cpuIdle:500,memoryTotal:8*1024**3,memoryAvailable:5*1024**3,
          swapTotal:0,swapFree:0,uptime:100,user:"developer",hostname:"linux-host",kernel:"6.18.54.1-microsoft-standard-WSL2",
          interface:"eth0",received:0,transmitted:0,diskRead:0,diskWritten:0,
          hostStorage: window.noHost ? null : {
            volume: window.launchProfiles[args.sessionId]?.distribution==='Ubuntu' ? 'C:\\' : 'D:\\',
            available: window.fullHost ? 0 : window.launchProfiles[args.sessionId]?.distribution==='Ubuntu' ? 20*1024**3 : 3*1024**3,
          },
          filesystems:[
            {device:"/dev/sdb",mount:"/usr/lib/linux-tools/6.18.54.1-microsoft-standard-WSL2",total:100*1024**2,used:100*1024**2,available:0},
            {device:"/dev/sde",mount:"/data",total:100*1024**3,used:90*1024**3,available:10*1024**3},
            {device:"/dev/sdd",mount:"/",total:1024**4,used:100*1024**3,available:900*1024**3},
            {device:"C:\\",mount:"/mnt/c",total:476*1024**3,used:421*1024**3,available:55*1024**3},
            {device:"D:\\",mount:"/mnt/d",total:477*1024**3,used:393*1024**3,available:85*1024**3},
            {device:"/dev/sdz",mount:"/usr/lib/linux-tools-custom",total:20*1024**3,used:2*1024**3,available:18*1024**3},
            {device:"none",mount:"/mnt/wslg",total:4*1024**3,used:100,available:4*1024**3-100},
          ],
        };
        if (command === "write_session" && window.holdInput)
          await new Promise(resolve => { window.releaseInput = resolve; });
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
  await page.locator("#monitor-toggle").click();
  await page.waitForFunction(() => document.querySelectorAll(".monitor-filesystem").length === 3);
  assert.equal(await page.locator(".monitor-filesystem-heading strong").first().innerText(), "/");
  assert.equal(await page.locator(".monitor-filesystem-heading strong").last().innerText(), "/usr/lib/linux-tools-custom");
  assert.equal(await page.locator("#monitor-filesystems").innerText().then(text => text.includes("linux-tools/6.")), false);
  assert.equal(await page.locator(".monitor-filesystem dl dd").count(), 9);
  assert(await page.locator(".monitor-filesystem").first().evaluate(card =>
    Math.abs(card.querySelector("dt").getBoundingClientRect().left - card.querySelector("dd").getBoundingClientRect().left) < 1 && card.querySelector("dd").getBoundingClientRect().top > card.querySelector("dt").getBoundingClientRect().bottom,
  ));
  assert.equal(await page.locator(".monitor-filesystem-bar").nth(1).getAttribute("data-load"), "critical");
  assert.equal(await page.locator("#monitor-identity").innerText().then(text => text.match(/6\.18\.54\.1/g)?.length), 1);
  assert.equal(await page.locator('#monitor-host-volume').innerText(), 'D:\\');
  assert.equal(await page.locator('#monitor-host-available').innerText(), '3 Gio');
  assert(await page.locator('.monitor-filesystem').first().innerText().then(text=>text.includes('Total virtuel') && text.includes('Libre virtuel')));
  assert.equal(await page.locator('#monitor-filesystems').innerText().then(text=>text.includes('/mnt/c') || text.includes('/mnt/d')), false);
  const contextPrevented = selector => page.locator(selector).evaluate(element => {
    const event = new MouseEvent("contextmenu", {bubbles:true,cancelable:true});
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert(await contextPrevented(".app-brand"));
  assert(await contextPrevented("#monitoring"));
  await page.locator("#settings-toggle").click();
  assert(await contextPrevented(".settings-tab .tab-select"));
  assert(await contextPrevented("#settings-nav"));
  assert.equal(await contextPrevented("#config-directory"), false);
  assert(await contextPrevented("#config-warn-paste"));
  await page.waitForFunction(() => document.querySelector("#save-settings").disabled);
  assert(await page.locator("#discard-settings").isDisabled());
  await page.locator("#config-warn-paste").check();
  assert(await page.locator("#save-settings").isEnabled());
  await page.locator("#config-warn-paste").uncheck();
  assert(await page.locator("#save-settings").isDisabled());
  await page.locator("#profile-add").click();
  await page.locator("#profile-name").fill("Developer");
  await page.locator("#profile-user").fill("developer");
  await page.locator("#profile-directory").fill("é".repeat(600));
  await page.locator("#profile-editor button[value=accept]").click();
  assert(await page.locator("#profile-dialog").isVisible());
  assert(await page.locator("#profile-error").isVisible());
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
  await page.locator("#config-trim-newlines").check();
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
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await page.locator("#tab-context-menu").evaluate(menu => menu.contains(document.activeElement)));
    await page.keyboard.press("ArrowDown");
    assert(await page.locator("#tab-context-menu").evaluate(menu => menu.contains(document.activeElement)));
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
  const wideText = await page.evaluate(() => {
    const cols = window.calls.filter(c=>c.command==='resize_session' && c.args.sessionId===3).at(-1)?.args.cols
      ?? window.calls.filter(c=>c.command==='start_session').at(-1).args.cols;
    const text = 'x'.repeat(cols-1)+'界';
    window.sessions[3].onmessage({kind:'data',bytes:Array.from(new TextEncoder().encode('\r\n'+text+'\r\n'))});
    return text;
  });
  await page.waitForFunction(() => document.querySelector('.terminal-pane:not([hidden]) .xterm-rows')?.innerText.includes('界'));
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
  const exported = await page.evaluate(() => window.calls.find(c=>c.command==='export_terminal_text').args.text);
  assert(exported.includes(wideText));
  before = await writes();
  await palette("Rechercher");
  await page.locator("#command-query").press("Enter");
  await page.waitForFunction(() => document.activeElement?.id==='query');
  await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.keyboard.type("focus-only");
  assert.equal(await page.locator("#query").inputValue(), "focus-only");
  assert.equal(await writes(), before);
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.sessions[3].onmessage({kind:"data",bytes:Array.from(new TextEncoder().encode(
    "\r\n" + "completed output\r\n".repeat(100) + "\x1b[20;1Hdeveloper@linux-host:~$ ",
  ))}));
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
  // ConPTY continues to draw at row 20 after the UI action: preserve that row.
  await page.evaluate(() => window.sessions[3].onmessage({kind:"data",bytes:Array.from(new TextEncoder().encode(
    "\x1b[20;25Hstill-connected",
  ))}));
  await page.waitForFunction(() => document.querySelector(".terminal-pane:not([hidden]) .xterm-rows")?.innerText.includes("developer@linux-host:~$ still-connected"));
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
  await page.evaluate(() => (window.clipboardText = "stale\npaste"));
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
  await page.waitForFunction(() => document.querySelector('#save-settings').disabled);
  await page.locator('#config-username').fill('legacy-user');
  await page.locator('#config-directory').fill('/srv/work');
  await page.locator('#save-settings').click();
  await page.waitForFunction(() => document.querySelector('#save-settings').disabled);
  await palette('Debian');
  await page.locator('#command-results button').filter({hasText:'Nouvel onglet · Debian'}).click();
  await page.waitForFunction(() => window.calls.filter(c=>c.command==='start_session').at(-1).args.profile.username==='legacy-user');
  assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.command==='start_session').at(-1).args.profile), {distribution:'Debian',username:'legacy-user',directory:'/srv/work'});
  await page.evaluate(() => {window.holdInput=true;window.clipboardText='x'.repeat(20000);});
  before=await writes();
  await page.keyboard.press('Control+Shift+V');
  await page.waitForFunction(()=>typeof window.releaseInput==='function');
  await context('readOnly');
  await page.evaluate(()=>{window.holdInput=false;window.releaseInput();});
  await page.waitForFunction(count => window.calls.filter(c=>c.command==='write_session').length===count+2, before);
  assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.command==='write_session').at(-1).args.bytes), [27,91,50,48,49,126]);
  await context('readOnly');
  before=await writes();
  await page.keyboard.type('resumed');
  await page.waitForFunction(count=>window.calls.filter(c=>c.command==='write_session').length>count,before);
  await page.locator('#settings-toggle').click();
  await page.locator('#config-language-button').click();
  await page.locator('#config-language-options [role=option]').filter({hasText:'English'}).click();
  await page.locator('#save-settings').click();
  await page.waitForFunction(()=>document.querySelector('#save-settings').disabled);
  assert.equal(await page.locator('#workflow-palette kbd').innerText(), 'Ctrl+Shift+P');
  await palette('Ubuntu');
  await page.locator('#command-results button').filter({hasText:'Ubuntu'}).click();
  await page.waitForFunction(()=>document.querySelector('#monitor-host-volume').textContent==='C:\\');
  assert.equal(await page.locator('#monitor-host-available').innerText(), '20 GiB');
  await page.evaluate(()=>{window.noHost=true;});
  await page.locator('#monitor-pause').click();
  await page.locator('#monitor-pause').click();
  await page.waitForFunction(()=>document.querySelector('#monitor-host-volume').textContent==='—');
  assert.equal(await page.locator('#monitor-host-available').innerText(), 'Unavailable');
  await page.evaluate(()=>{window.noHost=false;window.fullHost=true;});
  await page.locator('#monitor-pause').click();
  await page.locator('#monitor-pause').click();
  await page.waitForFunction(()=>document.querySelector('#monitor-host-available').classList.contains('host-full'));
  assert.match(await page.locator('#monitor-host-available').innerText(), /^0 /);
  // A WSL restart ends a PTY even though the app remains usable. Recovery is
  // local to the affected tab, persists after dismissing global notices, and
  // preserves both its buffer and profile when opening the replacement.
  const interruptedId = await page.evaluate(() => window.next);
  const launchCount = await page.evaluate(()=>window.calls.filter(c=>c.command==='start_session').length);
  const interruptedKey = await page.locator('.session-tab.active').getAttribute('data-tab');
  const originalProfile = await page.evaluate(id => window.launchProfiles[id], interruptedId);
  await page.evaluate(id => window.sessions[id].onmessage({kind:'exit', code:1, error:'WSL connection lost'}), interruptedId);
  const recovery = page.locator(`#${interruptedKey} .session-recovery`);
  await recovery.waitFor({state:'visible'});
  assert.match(await recovery.innerText(), /WSL connection lost/);
  assert.equal(await page.locator('#monitoring').isVisible(), true);
  assert.equal(await page.locator('#monitoring').evaluate(node=>node.classList.contains('stale')), true);
  await page.evaluate(() => document.querySelector('#notice-close').click());
  assert.equal(await recovery.isVisible(), true);
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='start_session').length),launchCount);
  await page.locator(`#${interruptedKey} .xterm-helper-textarea`).focus();
  before = await writes();
  await page.keyboard.type('never sent');
  assert.equal(await writes(), before);
  const oldBuffer = await page.locator(`#${interruptedKey} .xterm-rows`).textContent();
  await recovery.locator('button').click();
  await page.waitForFunction(id => window.next > id, interruptedId);
  await page.locator('.session-tab.active[data-state=connected]').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.launchProfiles[window.next]), originalProfile);
  assert.equal(await page.locator(`#${interruptedKey} .xterm-rows`).textContent(), oldBuffer);
  assert.equal(await page.locator('#monitoring').isVisible(), true);
  assert.equal(await page.locator('.terminal-pane:not([hidden]) .session-recovery').isVisible(), false);
  before = await writes();
  await page.keyboard.type('replacement works');
  await page.waitForFunction(count=>window.calls.filter(c=>c.command==='write_session').length>count,before);
  // Input transport failures also expose recovery, without waiting for Exit.
  await page.evaluate(()=>{window.failedInput=window.next;});
  await page.keyboard.type('x');
  await page.locator('.terminal-pane:not([hidden]) .session-recovery').waitFor({state:'visible'});
  assert.match(await page.locator('.terminal-pane:not([hidden]) .session-recovery').innerText(), /Session closed/);
  await page.locator('.terminal-pane:not([hidden]) .session-recovery button').click();
  await page.locator('.session-tab.active[data-state=connected]').waitFor();
  // An explicit stopped-distribution result is actionable even when a delayed
  // ConPTY Exit event has not arrived. It must not resume polling the dead PTY.
  const stoppedId = await page.evaluate(()=>window.next);
  await page.evaluate(()=>{window.stoppedSession=window.next;});
  await page.locator('#monitor-pause').click();
  await page.locator('#monitor-pause').click();
  await page.locator('.terminal-pane:not([hidden]) .session-recovery').waitFor({state:'visible'});
  const probes = await page.evaluate(id=>window.calls.filter(c=>c.command==='monitoring_snapshot' && c.args.sessionId===id).length, stoppedId);
  await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(id=>window.calls.filter(c=>c.command==='monitoring_snapshot' && c.args.sessionId===id).length,stoppedId),probes);
  assert.equal(await page.locator('#monitoring').isVisible(),true);
  await page.locator('.terminal-pane:not([hidden]) .session-recovery button').click();
  await page.locator('.session-tab.active[data-state=connected]').waitFor();
  await page.evaluate(()=>window.sessions[window.next].onmessage({kind:'exit',code:0,error:null}));
  await page.locator('.terminal-pane:not([hidden]) .session-recovery').waitFor({state:'visible'});
  assert.equal(await page.locator('.session-tab.active').getAttribute('data-state'),'exited');
  assert.deepEqual(errors, []);
  console.log(
    "PASS: profile CRUD/default/persistence, modal combo, tab rename/duplicate, read-only input/paste blocking and live output/copy, editable full paste preview/cancel/confirm, settings save state, chrome context menus, storage cards, ConPTY cursor after clearing history, palette, export, clear, close-others confirmation, WSL exit/write-failure/stopped recovery and stale monitoring.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
