import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { InputQueue } from "./transport";
import {
  defaults,
  themes,
  terminalTheme,
  formatBytes,
  type Config,
  type Distribution,
} from "./settings";
import "./style.css";
import { distributionIcon } from "./distribution-icons";
import { createProfile, type LaunchProfile } from "./settings";
import { initializeSelects, refreshSelect, closeSelects, refreshAllSelects } from "./select";
import { initializeWslManagement } from "./wsl-management";
import { listen } from "@tauri-apps/api/event";
import { t, setText, setLanguage, currentLanguage, languages, translateDocument, onLanguageChanged } from "./i18n";
import { prepareCopy, preparePaste } from "./clipboard";
import { installRectangularSelection } from "./rectangular-selection";
import { clipboardFits, historyLines, singleFlight } from "./resources";
import { initializeMonitoring } from "./monitoring";
import { installTerminalLinks } from "./terminal-links";
import { initializeTerminalWorkflow } from "./terminal-workflow";

type SessionEvent =
  | { kind: "data"; bytes: number[] }
  | { kind: "exit"; code: number | null; error: string | null };
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const field = (id: string) => el<HTMLInputElement>(`config-${id}`);
const native = isTauri();
let config: Config = structuredClone(defaults);
let booted = false;
let activeKey = "";
let nextTab = 0;
let settingsButton: HTMLElement | null = null;
let distributions: Distribution[] = [];
let dirty = false;
let savingConfig = false;
const tabs: TerminalTab[] = [];
const encoder = new TextEncoder();
let monitoring: ReturnType<typeof initializeMonitoring> | undefined;
let workflow: ReturnType<typeof initializeTerminalWorkflow> | undefined;

function showError(error: unknown): void {
  el("notice-text").textContent = String(
    error instanceof Error ? error.message : error,
  );
  el("notice").hidden = false;
}
function run(task: Promise<unknown>): void {
  void task.catch(showError);
}
function activeTerminal(): TerminalTab | undefined {
  return tabs.find((tab) => tab.key === activeKey);
}
function updateActions(): void {
  workflow?.refresh();
  monitoring?.sync();
  const tab = activeTerminal();
  for (const id of ["copy", "paste", "select-all", "search-toggle"])
    el<HTMLButtonElement>(id).disabled = !tab || (id === "paste" && (tab.readOnly || tab.sessionId === null));
  el<HTMLButtonElement>("reconnect").disabled =
    !tab || tab.sessionId !== null || tab.connecting;
  el<HTMLButtonElement>("new-tab").disabled = !booted || tabs.length >= 32;
  el<HTMLButtonElement>("menu-new").disabled = !booted || tabs.length >= 32;
  document
    .querySelectorAll<HTMLButtonElement>("[data-launch-distribution], [data-launch-profile]")
    .forEach((button) => {
      button.disabled = !booted || tabs.length >= 32;
    });
  el<HTMLButtonElement>("rectangular-selection").disabled = !tab;
  el("rectangular-selection").setAttribute("aria-pressed", String(tab?.rectangularSelection ?? false));
  el("rectangular-selection").querySelector(".rectangle-check")!.textContent = tab?.rectangularSelection ? "✓" : "";
}
function activate(key: string): void {
  closeSelects();
  activeKey = key;
  el("settings").hidden = key !== "settings";
  el("terminal-panes").hidden = key === "settings";
  el("empty-state").hidden = key !== "";
  el("search").hidden = true;
  for (const tab of tabs) {
    const selected = tab.key === key;
    tab.pane.hidden = !selected;
    tab.button.classList.toggle("active", selected);
    tab.select.setAttribute("aria-selected", String(selected));
    tab.select.tabIndex = selected ? 0 : -1;
  }
  if (settingsButton) {
    settingsButton.classList.toggle("active", key === "settings");
    settingsButton
      .querySelector("[role=tab]")
      ?.setAttribute("aria-selected", String(key === "settings"));
  }
  const selected = activeTerminal();
  if (selected)
    requestAnimationFrame(() => {
      if (activeKey === key) {
        selected.resize();
        selected.terminal.focus();
      }
    });
  updateActions();
}
function makeTab(
  key: string,
  title: string,
  icon: string,
  close: () => void,
): {
  button: HTMLDivElement;
  select: HTMLButtonElement;
  title: HTMLSpanElement;
} {
  const button = document.createElement("div");
  button.className = "session-tab";
  button.dataset.tab = key;
  const select = document.createElement("button");
  select.className = "tab-select";
  select.type = "button";
  select.setAttribute("role", "tab");
  const mark = document.createElement("span");
  mark.className = "tab-icon";
  if (key !== "settings") {
    const image = document.createElement("img");
    image.src = icon;
    image.alt = "";
    image.className = "tab-logo";
    mark.append(image);
  } else {
    mark.append(el("settings-toggle").querySelector("svg")!.cloneNode(true));
  }
  const label = document.createElement("span");
  label.className = "tab-title";
  label.textContent = title;
  const closeButton = document.createElement("button");
  closeButton.className = "tab-close";
  closeButton.type = "button";
  closeButton.textContent = "✕";
  closeButton.setAttribute("aria-label", t("tabs.close", { title }));
  select.append(mark, label);
  select.onclick = () => activate(key);
  closeButton.onclick = close;
  button.append(select, closeButton);
  el("tabs").append(button);
  select.onkeydown = (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      cycleTabs(event.key === "ArrowLeft" ? -1 : 1);
    }
  };
  return { button, select, title: label };
}
class TerminalTab {
  readonly key = `terminal-${++nextTab}`;
  readonly terminal = new Terminal({
    allowProposedApi: false,
    allowTransparency: false,
  });
  readonly fit = new FitAddon();
  search = new SearchAddon();
  readonly pane = document.createElement("div");
  readonly button: HTMLDivElement;
  readonly select: HTMLButtonElement;
  readonly title: HTMLSpanElement;
  sessionId: number | null = null;
  connecting = false;
  closed = false;
  expectedStop = false;
  rectangularSelection = false;
  readOnly = false;
  private shellTitle = "";
  private customTitle: string | null = null;
  private generation = 0;
  private hasShellTitle = false;
  private input: InputQueue | null = null;
  private pendingSize: { id: number; cols: number; rows: number } | null = null;
  private resizing = false;
  private lastSize: { id: number; cols: number; rows: number } | null = null;
  private output: Channel<SessionEvent> | null = null;

  constructor(readonly profile: LaunchProfile, name?: string) {
    this.customTitle = name ?? null;
    const tab = makeTab(this.key, profile.distribution, distributionIcon(profile.distribution), () =>
      closeTab(this),
    );
    this.button = tab.button;
    this.select = tab.select;
    this.title = tab.title;
    this.updateTitle();
    this.pane.className = "terminal-pane";
    this.pane.dataset.pane = this.key;
    this.pane.setAttribute("role", "tabpanel");
    this.select.setAttribute("aria-controls", this.key);
    this.pane.id = this.key;
    this.terminal.loadAddon(this.fit);
    this.terminal.loadAddon(this.search);
    installTerminalLinks(this.terminal, uri => {
      if (native) run(invoke("open_external_url", { url: uri }));
    }, () => t("terminal.openLinkHint"));
    el("terminal-panes").append(this.pane);
    this.terminal.open(this.pane);
    installRectangularSelection(this.pane, () => this.rectangularSelection, () => this.terminal.modes.mouseTrackingMode !== "none");
    this.pane.addEventListener("copy", event => {
      if (!this.terminal.hasSelection() || !event.clipboardData) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const text = prepareCopy(this.terminal.getSelection(), config.interaction.trimCopyWhitespace);
      if (!clipboardFits(text)) { showError(t("clipboard.tooLarge")); return; }
      event.clipboardData.setData("text/plain", text);
    }, true);
    this.pane.addEventListener("paste", event => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (this.sessionId === null) return;
      if (event.clipboardData) run(this.pasteText(event.clipboardData.getData("text/plain")));
      else run(this.paste());
    }, true);
    this.applyAppearance();
    this.terminal.onData((data) => {
      if (!this.readOnly && this.sessionId !== null) this.input?.push(encoder.encode(data));
    });
    this.terminal.onBinary((data) => {
      if (!this.readOnly && this.sessionId !== null)
        this.input?.push(
          Uint8Array.from(data, (char) => char.charCodeAt(0) & 255),
        );
    });
    this.terminal.onTitleChange((title) => {
      // ConPTY can announce wsl.exe before Linux sends its own OSC title.
      // Keep the distro label during that handover; do not delay shell startup.
      if (!this.hasShellTitle && /^[a-z]:[\\/](?:[^\\/\r\n]+[\\/])*(?:system32|sysnative)[\\/]wsl\.exe(?:\s.*)?$/i.test(title.trim())) return;
      if (title) this.hasShellTitle = true;
      delete this.select.dataset.i18nTitle;
      this.shellTitle = title;
      this.updateTitle();
    });
    this.terminal.onSelectionChange(() => {
      if (config.interaction.copyOnSelect && this.terminal.hasSelection())
        run(this.copy());
    });
    this.pane.addEventListener(
      "contextmenu",
      (event) => {
        event.preventDefault();
        if (
          config.interaction.rightClickPaste &&
          (event.shiftKey || this.terminal.modes.mouseTrackingMode === "none")
        ) {
          run(this.paste());
        } else if (
          this.terminal.modes.mouseTrackingMode === "none" ||
          event.shiftKey
        ) {
          activate(this.key);
          menu.hidden = false;
          menuToggle.setAttribute("aria-expanded", "true");
          menu.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - 310))}px`;
        }
      },
      true,
    );
  }
  updateTitle(): void {
    this.title.textContent = this.customTitle || this.shellTitle || this.profile.distribution;
    if (this.customTitle) this.title.dataset.customName = this.customTitle;
    else delete this.title.dataset.customName;
    this.select.title = `${this.title.textContent}${this.readOnly ? " · " + t("workflow.readOnlyState") : ""}`;
    this.select.setAttribute("aria-label", this.select.title);
    this.button.querySelector(".tab-close")?.setAttribute("aria-label",t("tabs.close",{title:this.title.textContent}));
  }
  clearHistory(): void {
    if (this.closed || this.terminal.buffer.active.type !== "normal") return;
    // Clearing xterm does not invalidate SearchAddon's retained line cache.
    this.search.dispose();
    this.terminal.clearSelection();
    this.terminal.clear();
    this.search = new SearchAddon();
    this.terminal.loadAddon(this.search);
    this.terminal.focus();
  }
  rename(name: string): void { this.customTitle = name.slice(0,80) || null; this.updateTitle(); }
  setReadOnly(value: boolean): void {
    this.readOnly = value;
    this.terminal.options.disableStdin = value;
    this.input?.cancel(); this.input = null;
    const id = this.sessionId;
    if (!value && id !== null) this.input = new InputQueue(bytes => this.readOnly || this.sessionId !== id ? Promise.resolve() : invoke("write_session",{sessionId:id,bytes}), showError);
    this.button.classList.toggle("read-only",value); this.updateTitle(); updateActions();
  }
  applyAppearance(): void {
    this.setRectangularSelection(config.interaction.rectangularSelection);
    const appearance = config.appearance;
    this.terminal.options.fontFamily = appearance.fontFamily;
    this.terminal.options.fontSize = appearance.fontSize;
    this.terminal.options.cursorStyle = appearance.cursorStyle;
    this.terminal.options.cursorBlink = appearance.cursorBlink;
    this.applyTheme();
    this.resize();
  }
  applyTheme(): void {
    const theme = terminalTheme(config.appearance);
    this.terminal.options.theme = theme;
    this.pane.style.setProperty("--terminal-background", theme.background!);
  }
  resize(): void {
    if (this.closed || activeKey !== this.key || this.pane.hidden) return;
    this.fit.fit();
    reconcileHistory();
    if (this.sessionId === null) return;
    this.pendingSize = {
      id: this.sessionId,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    };
    void this.flushSize();
  }
  private async flushSize(): Promise<void> {
    if (this.resizing) return;
    this.resizing = true;
    try {
      while (this.pendingSize && !this.closed) {
        const size = this.pendingSize;
        this.pendingSize = null;
        if (size.id !== this.sessionId) continue;
        if (this.lastSize?.id === size.id && this.lastSize.cols === size.cols && this.lastSize.rows === size.rows) continue;
        try {
          await invoke("resize_session", {
            sessionId: size.id,
            cols: size.cols,
            rows: size.rows,
          });
          this.lastSize = size;
        } catch (error) {
          if (!this.closed && size.id === this.sessionId) showError(error);
        }
      }
    } finally {
      this.resizing = false;
    }
  }
  async start(): Promise<void> {
    if (this.connecting || this.sessionId !== null || this.closed) return;
    this.expectedStop = false;
    this.hasShellTitle = false;
    this.connecting = true;
    const generation = ++this.generation;
    this.button.dataset.state = "connecting";
    this.select.title = t("tabs.connecting");
    this.select.dataset.i18nTitle = "tabs.connecting";
    this.shellTitle = ""; this.updateTitle();
    this.terminal.reset();
    updateActions();
    if (!native) {
      this.terminal.write(
        `${t("tabs.preview")}\r\n${t("tabs.previewHint")}\r\n`,
      );
      this.connecting = false;
      this.button.dataset.state = "preview";
      updateActions();
      return;
    }
    let resolveId!: (id: number | null) => void;
    const idReady = new Promise<number | null>((resolve) => {
      resolveId = resolve;
    });
    let exited = false;
    const channel = new Channel<SessionEvent>();
    this.output = channel;
    channel.onmessage = (event) => {
      if (this.closed || generation !== this.generation) return;
      if (event.kind === "data") {
        const bytes = event.bytes.length;
        this.terminal.write(new Uint8Array(event.bytes), () => {
          if (this.closed || generation !== this.generation) return;
          run(
            idReady.then((id) =>
              id === null
                ? undefined
                : invoke("ack_output", {
                    sessionId: id,
                    bytes,
                  }),
            ),
          );
        });
      } else {
        channel.onmessage = () => {};
        this.output = null;
        exited = true;
        this.input?.cancel();
        this.sessionId = null;
        this.button.dataset.state =
          !this.expectedStop && (event.error || event.code) ? "error" : "exited";
        this.select.title = `${t("tabs.ended")}${event.code === null ? "" : ` · ${event.code}`}`;
        delete this.select.dataset.i18nTitle;
        if (!this.expectedStop && event.error) showError(event.error);
        else if (!this.expectedStop && event.code)
          showError(
            t("tabs.unexpectedExit"),
          );
        updateActions();
      }
    };
    try {
      const id = await invoke<number>("start_session", {
        cols: this.terminal.cols,
        rows: this.terminal.rows,
        output: channel,
        profile: this.profile,
      });
      resolveId(id);
      if (this.closed) {
        await invoke("close_session", { sessionId: id });
        return;
      }
      if (!exited) {
        this.sessionId = id;
        this.input = new InputQueue(
          (bytes) => this.readOnly || this.sessionId !== id ? Promise.resolve() : invoke("write_session", { sessionId: id, bytes }),
          showError,
        );
        this.button.dataset.state = "connected";
        this.select.title = t("tabs.connected");
        this.select.dataset.i18nTitle = "tabs.connected";
        this.resize();
      }
      if (activeKey === this.key) this.terminal.focus();
    } catch (error) {
      resolveId(null);
      if (!this.closed) {
        this.button.dataset.state = "error";
        this.select.title = t("tabs.connectionFailed");
        this.select.dataset.i18nTitle = "tabs.connectionFailed";
        showError(error);
      }
    } finally {
      this.connecting = false;
      updateActions();
    }
  }
  async copy(): Promise<void> {
    if (this.terminal.hasSelection()) {
      const text = prepareCopy(this.terminal.getSelection(), config.interaction.trimCopyWhitespace);
      if (!clipboardFits(text)) { showError(t("clipboard.tooLarge")); return; }
      await invoke("clipboard_write", { text });
    }
  }
  setRectangularSelection(enabled: boolean): void {
    this.rectangularSelection = enabled;
    this.pane.classList.toggle("rectangle-mode", enabled);
  }
  private async pasteText(text: string): Promise<void> {
    if (this.closed || this.readOnly || this.sessionId === null) return;
    if (!clipboardFits(text)) { showError(t("clipboard.tooLarge")); return; }
    const prepared = preparePaste(text, config.interaction);
    const id = this.sessionId, generation = this.generation;
    if (!prepared || !await workflow?.confirmPaste(prepared, config.interaction.warnMultilinePaste)) return;
    if (this.closed || this.readOnly || this.sessionId !== id || this.generation !== generation) return;
    this.terminal.paste(prepared);
    this.terminal.focus();
  }
  async restart(): Promise<void> {
    if (this.closed) return;
    if (this.connecting) throw new Error(t("tabs.stillConnecting"));
    this.input?.cancel();
    const id = this.sessionId;
    this.sessionId = null;
    if (id !== null) await invoke("close_session", { sessionId: id });
    await this.start();
    if (!this.closed && this.button.dataset.state !== "connected") throw new Error(t("tabs.restartFailed", { distribution: this.profile.distribution }));
  }
  async paste(): Promise<void> {
    if (this.closed || this.readOnly || this.sessionId === null) return;
    if (this.sessionId === null) return;
    const id = this.sessionId;
    const text = await invoke<string>("clipboard_read");
    if (!this.closed && !this.readOnly && this.sessionId === id) await this.pasteText(text);
  }
  dispose(): void {
    this.closed = true;
    this.generation++;
    if (this.output) this.output.onmessage = () => {};
    this.output = null;
    this.input?.cancel();
    if (this.sessionId !== null)
      run(invoke("close_session", { sessionId: this.sessionId }));
    this.sessionId = null;
    this.terminal.dispose();
    this.button.remove();
    this.pane.remove();
  }
}
function reconcileHistory(): void {
  const lines = historyLines(config.appearance.scrollback, tabs.map(tab => ({ cols: tab.terminal.cols, rows: tab.terminal.rows })));
  for (const tab of tabs) if (tab.terminal.options.scrollback !== lines) tab.terminal.options.scrollback = lines;
}
function newTab(distribution?: string, start = true, profile?: LaunchProfile, name?: string): TerminalTab | undefined {
  if (!booted || tabs.length >= 32) return;
  const selected = distribution === undefined && !profile ? config.profiles.find(p=>p.id===config.defaultProfileId) : undefined;
  const tab = new TerminalTab(profile ?? createProfile(config, distribution), name ?? selected?.name);
  tabs.push(tab);
  reconcileHistory();
  if (settingsButton) el("tabs").insertBefore(tab.button, settingsButton);
  activate(tab.key);
  tab.resize();
  if (start) run(tab.start());
  tab.button.scrollIntoView({ block: "nearest", inline: "nearest" });
  return tab;
}
function closeTab(tab: TerminalTab): void {
  const index = tabs.indexOf(tab);
  if (index < 0) return;
  const wasActive = activeKey === tab.key;
  tab.dispose();
  tabs.splice(index, 1);
  reconcileHistory();
  if (wasActive)
    activate(
      tabs[Math.min(index, tabs.length - 1)]?.key ??
        (settingsButton ? "settings" : ""),
    );
  updateActions();
}
function cycleTabs(direction: number): void {
  const keys = [
    ...tabs.map((tab) => tab.key),
    ...(settingsButton ? ["settings"] : []),
  ];
  if (keys.length)
    activate(
      keys[(keys.indexOf(activeKey) + direction + keys.length) % keys.length],
    );
}
let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => activeTerminal()?.resize());
}).observe(el("workspace"));
function toggleSearch(open = el("search").hidden): void {
  if (!activeTerminal()) return;
  el("search").hidden = !open;
  if (open) el<HTMLInputElement>("query").focus();
  else {
    activeTerminal()?.search.clearDecorations();
    activeTerminal()?.terminal.focus();
  }
}

let installedFonts: string[] = [];
function populateFonts(selected: string): void {
  const select = el<HTMLSelectElement>("config-font");
  select.replaceChildren(new Option(t("appearance.automaticFont"), defaults.appearance.fontFamily));
  for (const font of installedFonts) {
    const option = new Option(font, `${JSON.stringify(font)}, monospace`);
    option.dataset.fontFamily = option.value;
    select.add(option);
  }
  if (!Array.from(select.options).some(option => option.value === selected))
    select.add(new Option(t("appearance.currentFont", { font: selected }), selected));
  select.value = selected;
  refreshSelect(select.id);
}
async function loadFonts(): Promise<void> {
  try {
    installedFonts = native ? await invoke<string[]>("list_terminal_fonts") : [];
    populateFonts(field("font").value || config.appearance.fontFamily);
  } catch (error) {
    showError(t("appearance.fontsUnavailable", { error: String(error) }));
  }
}
const refreshFonts = singleFlight(loadFonts);

function readDraft(): Config {
  return {
    language: field("language").value,
    monitoringEnabled: field("monitoring").checked,
    profiles: workflow?.draftProfiles() ?? config.profiles,
    defaultProfileId: field("default-profile").value || null,
    distribution: field("distribution").value.trim(),
    username: field("username").value.trim() || null,
    directory: field("directory").value.trim(),
    appearance: {
      uiTheme: field("ui-theme").checked ? "light" : "dark",      fontFamily: field("font").value.trim(),
      fontSize: Number(field("font-size").value),
      theme: field("theme").value,
      cursorStyle: el<HTMLSelectElement>("config-cursor")
        .value as Config["appearance"]["cursorStyle"],
      cursorBlink: field("blink").checked,
      scrollback: Number(field("scrollback").value),
    },
    interaction: {
      copyOnSelect: field("copy").checked,
      rightClickPaste: field("right-click").checked,
      trimCopyWhitespace: field("trim-copy").checked,
      trimPasteWhitespace: field("trim-paste").checked,
      trimPasteNewlines: field("trim-newlines").checked,
      rectangularSelection: field("rectangle").checked,
      warnOnClose: field("warn-close").checked,
      warnMultilinePaste: field("warn-paste").checked,
    },
    wslSettingsPath: field("wsl-path").value.trim(),
  };
}
function loadFields(): void {
  workflow?.loadFields();
  field("monitoring").checked = config.monitoringEnabled;
  const language = el<HTMLSelectElement>("config-language");
  language.replaceChildren(...languages.map(item => new Option(item.name, item.code)));
  language.value = languages.some(item => item.code === config.language) ? config.language : currentLanguage();
  refreshSelect(language.id);
  updateDistributionChoices(config.distribution);
  field("username").value = config.username ?? "";
  field("directory").value = config.directory;
  field("ui-theme").checked = config.appearance.uiTheme === "light";
  populateFonts(config.appearance.fontFamily);
  field("font-size").value = String(config.appearance.fontSize);
  field("theme").value = config.appearance.theme;
  el<HTMLSelectElement>("config-cursor").value = config.appearance.cursorStyle;
  refreshSelect("config-cursor");
  field("blink").checked = config.appearance.cursorBlink;
  field("scrollback").value = String(config.appearance.scrollback);
  field("copy").checked = config.interaction.copyOnSelect;
  field("right-click").checked = config.interaction.rightClickPaste;
  field("trim-copy").checked = config.interaction.trimCopyWhitespace;
  field("trim-paste").checked = config.interaction.trimPasteWhitespace;
  field("trim-newlines").checked = config.interaction.trimPasteNewlines;
  field("rectangle").checked = config.interaction.rectangularSelection;
  field("warn-close").checked = config.interaction.warnOnClose;
  field("warn-paste").checked = config.interaction.warnMultilinePaste;
  field("wsl-path").value = config.wslSettingsPath;
  dirty = false;
  updateDraft();
}
function updateDraft(): void {
  const draft = readDraft();
  for (const id of ['distribution','username','directory']) field(id).disabled = draft.defaultProfileId !== null;
  refreshSelect('config-distribution');
  dirty = JSON.stringify(draft) !== JSON.stringify(config);
  if (dirty) setText(el("save-status"), "settings.unsaved");
  else { el("save-status").removeAttribute("data-i18n"); el("save-status").textContent = ""; }
  el<HTMLButtonElement>("save-settings").disabled = !dirty || savingConfig;
  el<HTMLButtonElement>("discard-settings").disabled = !dirty;
  el<HTMLButtonElement>("open-wsl-settings").disabled =
    draft.wslSettingsPath !== config.wslSettingsPath;
  applyInterfaceTheme(draft.appearance.uiTheme);
  const theme = terminalTheme(draft.appearance);
  const preview = el("appearance-preview");
  preview.style.backgroundColor = theme.background!;
  preview.style.color = theme.foreground!;
  preview.style.fontFamily = draft.appearance.fontFamily;
  preview.style.fontSize = `${Math.max(8, Math.min(32, draft.appearance.fontSize || 14))}px`;
  preview.style.setProperty("--preview-green", theme.green!);
  preview.style.setProperty("--preview-blue", theme.brightBlue!);
  document
    .querySelectorAll<HTMLElement>("[data-theme]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.theme === draft.appearance.theme),
      ),
    );
}
function settingsPage(page: string): void {
  if (page === "management" || page === "installation") run(wslManagement.refresh());
  if (page === "installation") wslManagement.visitInstallation();
  el("wsl-operation-output").hidden = !["management", "installation"].includes(page) || !el("wsl-operation-state").dataset.state;
  document
    .querySelectorAll<HTMLElement>("[data-section]")
    .forEach((section) => {
      section.hidden = section.dataset.section !== page;
    });
  document.querySelectorAll<HTMLElement>("[data-page]").forEach((button) => {
    const selected = button.dataset.page === page;
    button.classList.toggle("selected", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  el("settings-content").scrollTop = 0;
}
function openSettings(): void {
  if (!booted) return;
  if (!settingsButton) {
    settingsButton = makeTab(
      "settings",
      t("common.settings"),
      "",
      closeSettings,
    ).button;
    settingsButton.classList.add("settings-tab");
    loadFields();
  }
  activate("settings");
  wslManagement.visit();
  run(refreshDistributions());
  run(refreshWslConfig());
  run(refreshFonts());
}
function finishCloseSettings(): void {
  settingsButton?.remove();
  settingsButton = null;
  dirty = false;
  if (activeKey === "settings") activate(tabs[tabs.length - 1]?.key ?? "");
}
function closeSettings(): void {
  if (dirty) el<HTMLDialogElement>("discard-dialog").showModal();
  else finishCloseSettings();
}
function requestWindowClose(): void {
  const dialog = el<HTMLDialogElement>("close-window-dialog");
  if (dialog.open) return;
  if ((config.interaction.warnOnClose && tabs.length > 1) || dirty) {
    setText(el("close-window-message"), tabs.length > 1 ? "closing.multiple" : "closing.single", { count: tabs.length });
    el("close-window-unsaved").hidden = !dirty;
    closeSelects();
    dialog.showModal();
  } else run(invoke("confirm_close_window"));
}
async function saveSettings(): Promise<void> {
  if (savingConfig) return;
  const form = el<HTMLFormElement>("settings-form");
  const invalid = form.querySelector<HTMLInputElement>(":invalid");
  if (invalid) {
    const page =
      invalid.closest<HTMLElement>("[data-section]")?.dataset.section;
    if (page) settingsPage(page);
    invalid.reportValidity();
    return;
  }
  const draft = readDraft();
  savingConfig = true;
  el<HTMLButtonElement>("theme-toggle").disabled = true;
  el<HTMLButtonElement>("save-settings").disabled = true;
  try {
    if (!native)
      throw new Error(t("settings.saveUnavailable"));
    config = await invoke<Config>("save_config", { config: draft });
    await setLanguage(config.language);
    tabs.forEach((tab) => tab.applyAppearance());
    reconcileHistory();
    updateActions();
    loadFields();
    renderDistributionMenu();
    setText(el("save-status"), "settings.saved");
  } catch (error) {
    showError(error);
    updateDraft();
  } finally {
    savingConfig = false;
    el<HTMLButtonElement>("theme-toggle").disabled = false;
    el<HTMLButtonElement>("save-settings").disabled = !dirty;
  }
}
function updateDistributionChoices(selected: string): void {
  const select = el<HTMLSelectElement>("config-distribution");
  select.replaceChildren();
  const names = distributions.map((distribution) => distribution.name);
  if (selected && !names.includes(selected)) names.unshift(selected);
  if (!names.length) names.push(config.distribution);
  for (const name of names) select.add(new Option(name, name));
  select.value = selected || config.distribution;
  refreshSelect(select.id);
}
function renderDistributionMenu(): void {
  workflow?.renderProfileMenu();
  const focusedDistribution = (document.activeElement as HTMLElement | null)
    ?.dataset.launchDistribution;
  const group = el("distribution-menu");
  group.replaceChildren();
  const entries = [...distributions];
  const defaultDistribution = createProfile(config).distribution;
  if (!entries.some((entry) => entry.name === config.distribution))
    entries.unshift({
      name: config.distribution,
      version: null,
      basePath: "",
      vhdPath: null,
      fileBytes: null,
    });
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "distribution-menu-item";
    button.dataset.launchDistribution = entry.name;
    const image = document.createElement("img");
    image.src = distributionIcon(entry.name);
    image.alt = "";
    image.className = "tab-logo";
    const name = document.createElement("span");
    name.className = "distribution-name";
    name.textContent = entry.name;
    const detail = document.createElement("span");
    detail.className = "distribution-detail";
    detail.textContent =
      entry.name === defaultDistribution
        ? t("common.default")
        : entry.version
          ? `WSL ${entry.version}`
          : "";
    button.append(image, name, detail);
    button.onclick = () => newTab(entry.name);
    group.append(button);
    if (focusedDistribution === entry.name && !el("terminal-menu").hidden)
      button.focus({ preventScroll: true });
  }
  updateActions();
}
async function loadWslConfig(): Promise<void> {
  el<HTMLButtonElement>("open-wsl-config").disabled = true;
  const info = native
    ? await invoke<{ path: string; exists: boolean }>("wsl_config_info")
    : { path: "%USERPROFILE%\\.wslconfig", exists: false };
  el("wsl-config-path").textContent = info.path;
  setText(el("wsl-config-status"), info.exists ? "storage.configFound" : "storage.configMissing");
  el<HTMLButtonElement>("open-wsl-config").disabled = !info.exists;
}
const refreshWslConfig = singleFlight(loadWslConfig);
async function loadDistributions(): Promise<void> {
  const previous =
    el<HTMLSelectElement>("storage-distribution").value || config.distribution;
  el<HTMLButtonElement>("refresh-storage").disabled = true;
  try {
    distributions = native
      ? await invoke<Distribution[]>("list_distributions")
      : [];
    const select = el<HTMLSelectElement>("storage-distribution");
    select.replaceChildren();
    for (const distribution of distributions) {
      const option = new Option(distribution.name, distribution.name);
      select.add(option);
    }
    if (!distributions.length)
      select.add(new Option(t("storage.noDistributions"), ""));
    select.value = distributions.some((d) => d.name === previous)
      ? previous
      : (distributions[0]?.name ?? "");
    updateStorage();
    refreshSelect("storage-distribution");
    updateDistributionChoices(
      field("distribution").value || config.distribution,
    );
    renderDistributionMenu();
  } finally {
    el<HTMLButtonElement>("refresh-storage").disabled = false;
  }
}
const refreshDistributions = singleFlight(loadDistributions);
function updateStorage(): void {
  const selected = distributions.find(
    (d) => d.name === el<HTMLSelectElement>("storage-distribution").value,
  );
  el("storage-version").textContent = selected?.version
    ? `WSL ${selected.version}`
    : "—";
  el("storage-path").textContent =
    selected?.version === 1
      ? t("storage.wsl1")
      : (selected?.vhdPath ?? t("storage.pathUnavailable"));
  el("storage-size").textContent =
    selected?.version === 1
      ? t("storage.notApplicable")
      : formatBytes(selected?.fileBytes ?? null);
  el<HTMLButtonElement>("open-storage").disabled = !selected?.basePath;
}
function initializeThemes(): void {
  const names = {
    campbell: "Campbell",
    oneHalfDark: "One Half Dark",
    light: "One Half Light",
    darkPlus: "Dark+",
    solarizedDark: "Solarized Dark",
  };
  for (const key of [
    "campbell",
    "darkPlus",
    "oneHalfDark",
    "light",
    "solarizedDark",
  ]) {
    const theme = themes[key];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-option";
    button.dataset.theme = key;
    button.style.setProperty("--swatch-background", theme.background!);
    button.style.setProperty("--swatch-foreground", theme.foreground!);
    const palette = document.createElement("span");
    palette.className = "palette";
    palette.style.backgroundColor = theme.background!;
    for (const color of [
      "black",
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "white",
      "brightBlack",
      "brightRed",
      "brightGreen",
      "brightYellow",
      "brightBlue",
      "brightMagenta",
      "brightCyan",
      "brightWhite",
    ]) {
      const sample = document.createElement("span");
      const value = theme[color as keyof typeof theme];
      sample.style.backgroundColor = typeof value === "string" ? value : "#fff";
      palette.append(sample);
    }
    const label = document.createElement("span");
    label.textContent = names[key as keyof typeof names];
    const check = document.createElement("span");
    check.className = "theme-check";
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    button.append(palette, label, check);
    button.onclick = () => {
      field("theme").value = key;
      updateDraft();
    };
    el("theme-options").append(button);
  }
}

const menu = el("terminal-menu");
const menuToggle = el<HTMLButtonElement>("menu-toggle");
function closeMenu(): void {
  menu.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");
}
menuToggle.onclick = () => {
  closeSelects();
  menu.hidden = !menu.hidden;
  menuToggle.setAttribute("aria-expanded", String(!menu.hidden));
  if (!menu.hidden) {
    run(refreshDistributions());
    menu.style.left = `${Math.min(menuToggle.getBoundingClientRect().left, window.innerWidth - 310)}px`;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }
};
menu.onclick = closeMenu;
menu.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(
    menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  );
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
          items.length;
  event.preventDefault();
  items[next]?.focus();
});
document.addEventListener("pointerdown", (event) => {
  if (
    !menu.contains(event.target as Node) &&
    !menuToggle.contains(event.target as Node)
  )
    closeMenu();
});
document.addEventListener(
  "keydown",
  (event) => {
    if (document.querySelector("dialog[open]")) return;
    if (event.key === "Escape" && !menu.hidden) {
      closeMenu();
      activeTerminal()?.terminal.focus();
      return;
    }
    if (event.altKey || !event.ctrlKey) return;
    const key = event.key.toLowerCase();
    let action: (() => void) | undefined;
    if (event.shiftKey && key === "t") action = newTab;
    else if (event.shiftKey && key === "w")
      action = () => {
        if (activeKey === "settings") closeSettings();
        else {
          const tab = activeTerminal();
          if (tab) closeTab(tab);
        }
      };
    else if (key === "tab") action = () => cycleTabs(event.shiftKey ? -1 : 1);
    else if (key === ",") action = openSettings;
    else if (!event.shiftKey && /^[1-9]$/.test(key))
      action = () => {
        const keys = [
          ...tabs.map((tab) => tab.key),
          ...(settingsButton ? ["settings"] : []),
        ];
        const target =
          key === "9" ? keys[keys.length - 1] : keys[Number(key) - 1];
        if (target) activate(target);
      };
    const tab = activeTerminal();
    const target = event.target as HTMLElement;
    const terminalInput =
      !target.closest("input,select,textarea") ||
      target.classList.contains("xterm-helper-textarea");
    if (!action && tab && terminalInput) {
      if (event.shiftKey && key === "c") action = () => run(tab.copy());
      else if (event.shiftKey && key === "v") action = () => run(tab.paste());
      else if (event.shiftKey && key === "a")
        action = () => tab.terminal.selectAll();
      else if (event.shiftKey && key === "f") action = () => toggleSearch();
      else if (["+", "=", "-", "0"].includes(key))
        action = () => {
          tab.terminal.options.fontSize =
            key === "0"
              ? config.appearance.fontSize
              : Math.max(
                  8,
                  Math.min(
                    32,
                    (tab.terminal.options.fontSize ?? 14) +
                      (key === "-" ? -1 : 1),
                  ),
                );
          tab.resize();
        };
    }
    if (action) {
      event.preventDefault();
      event.stopImmediatePropagation();
      action();
    }
  },
  true,
);
// Shift+Insert is handled separately so ordinary Insert reaches Linux.
document.addEventListener(
  "keydown",
  (event) => {
    if (
      event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.key === "Insert" &&
      activeTerminal() &&
      (event.target as HTMLElement).classList.contains("xterm-helper-textarea")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      run(activeTerminal()!.paste());
    }
  },
  true,
);
for (const id of ["new-tab", "menu-new", "empty-new"])
  el(id).onclick = () => newTab();
const wslManagement = initializeWslManagement({
  native,
  distributions: () => distributions,
  refreshDistributions,
  launch: distribution => { newTab(distribution); },
  prepareStop: distribution => {
    const affected = tabs.filter(tab => distribution === null || tab.profile.distribution === distribution);
    const previous = affected.map(tab => tab.expectedStop);
    affected.forEach(tab => { tab.expectedStop = true; });
    updateActions();
    return () => { affected.forEach((tab, index) => { tab.expectedStop = previous[index]; }); updateActions(); };
  },
  prepareRestartAll: () => {
    const active = tabs.filter(tab => !tab.closed && (tab.sessionId !== null || tab.connecting));
    return async () => { for (const tab of active) if (!tab.closed) await tab.restart(); };
  },
  restart: async distribution => {
    let targets = tabs.filter(tab => !tab.closed && tab.profile.distribution === distribution);
    if (!targets.length) {
      const tab = newTab(distribution, false);
      if (!tab) throw new Error(t("tabs.limit"));
      targets = [tab];
    }
    for (const tab of targets) await tab.restart();
  },
  error: showError,
});
monitoring = initializeMonitoring({
  native,
  error: showError,
  target: () => {
    const tab = config.monitoringEnabled ? activeTerminal() : undefined;
    return tab?.sessionId != null && !tab.closed && !tab.expectedStop ? { sessionId: tab.sessionId, distribution: tab.profile.distribution, username: tab.profile.username } : null;
  },
  resize: () => requestAnimationFrame(() => activeTerminal()?.resize()),
});
el("settings-toggle").onclick = openSettings;
el("about-github").onclick = () => {
  if (native) run(invoke("open_external_url", { url: "https://github.com/DooSys/DooTTY/" }));
  else window.open("https://github.com/DooSys/DooTTY/", "_blank", "noopener,noreferrer");
};
el("copy").onclick = () => {
  const tab = activeTerminal();
  if (tab) {
    run(tab.copy());
    tab.terminal.focus();
  }
};
el("paste").onclick = () => {
  const tab = activeTerminal();
  if (tab) run(tab.paste());
};
el("select-all").onclick = () => {
  activeTerminal()?.terminal.selectAll();
  activeTerminal()?.terminal.focus();
};
el("rectangular-selection").onclick = () => {
  const tab = activeTerminal();
  if (tab) { tab.setRectangularSelection(!tab.rectangularSelection); updateActions(); tab.terminal.focus(); }
};
el("search-toggle").onclick = () => toggleSearch();
el("reconnect").onclick = () => {
  const tab = activeTerminal();
  if (tab) run(tab.start());
};
el("notice-close").onclick = () => {
  el("notice").hidden = true;
};
el("search-close").onclick = () => toggleSearch(false);
el<HTMLFormElement>("search").onsubmit = (event) => {
  event.preventDefault();
  activeTerminal()?.search.findNext(el<HTMLInputElement>("query").value);
};
el("query").onkeydown = (event) => {
  if (event.key === "Escape") toggleSearch(false);
  else if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    activeTerminal()?.search.findPrevious(el<HTMLInputElement>("query").value);
  }
};
document
  .querySelectorAll<HTMLButtonElement>("[data-page]")
  .forEach((button) => {
    button.onclick = () => settingsPage(button.dataset.page!);
  });
el("settings-form").oninput = updateDraft;
el<HTMLFormElement>("settings-form").onsubmit = (event) => {
  event.preventDefault();
  run(saveSettings());
};
el("discard-settings").onclick = () => {
  loadFields();
  setText(el("save-status"), "settings.cancelled");
};
el("keep-editing").onclick = () =>
  el<HTMLDialogElement>("discard-dialog").close();
el("confirm-discard").onclick = () => {
  el<HTMLDialogElement>("discard-dialog").close();
  finishCloseSettings();
};
el("cancel-close-window").onclick = () => el<HTMLDialogElement>("close-window-dialog").close();
el("confirm-close-window").onclick = () => {
  el<HTMLDialogElement>("close-window-dialog").close();
  run(invoke("confirm_close_window"));
};
el("open-wsl-settings").onclick = () => run(invoke("open_wsl_settings"));
el("refresh-storage").onclick = () => {
  run(refreshDistributions());
  run(refreshWslConfig());
};
el<HTMLSelectElement>("storage-distribution").onchange = updateStorage;
el("open-storage").onclick = () =>
  run(
    invoke("open_storage_folder", {
      distribution: el<HTMLSelectElement>("storage-distribution").value,
    }),
  );
el("open-wsl-config").onclick = () => run(invoke("open_wsl_config"));
el("wsl-config-help").onclick = () => run(invoke("open_wsl_config_help"));
initializeThemes();
workflow = initializeTerminalWorkflow({
  config:()=>config, tabs:()=>tabs, active:activeTerminal, distributions:()=>distributions,
  open:(profile,name)=>{newTab(undefined,true,profile,name);},
  activate, close:tab=>{const current=tabs.find(item=>item.key===tab.key);if(current)closeTab(current);},
  settings:page=>{openSettings();settingsPage(page);}, search:()=>toggleSearch(),
  changed:updateDraft, closeMenu, error:showError, native,
});
initializeSelects();
onLanguageChanged(() => {
  closeSelects();
  translateDocument();
  populateFonts(field("font").value || config.appearance.fontFamily);
  renderDistributionMenu();
  workflow?.refresh();
  updateStorage();
  if (settingsButton) {
    settingsButton.querySelector<HTMLElement>(".tab-title")!.textContent = t("common.settings");
    settingsButton.querySelector(".tab-close")!.setAttribute("aria-label", t("tabs.close", { title: t("common.settings") }));
  }
  for (const tab of tabs) {
    tab.updateTitle();
    tab.button.querySelector(".tab-close")!.setAttribute("aria-label", t("tabs.close", { title: tab.title.textContent }));
    if (tab.button.dataset.state === "connecting") tab.select.title = t("tabs.connecting");
    else if (tab.button.dataset.state === "error") tab.select.title = t("tabs.connectionFailed");
    else if (tab.button.dataset.state === "exited") tab.select.title = t("tabs.ended");
  }
  refreshAllSelects();
});
el<HTMLSelectElement>("config-distribution").addEventListener("change", () => {
  field("username").value = "";
  field("directory").value = "~";
  updateDraft();
});
loadFields();
settingsPage("general");
if (native) {
  run(listen("wsl-operation-active", () => showError(t("management.waitBeforeClosing"))));
  const window = getCurrentWindow();
  // Mouse use of the title bar keeps typing in the current terminal or form.
  // Keyboard navigation can still focus and activate these buttons normally.
  for (const button of document.querySelectorAll<HTMLButtonElement>(".window-controls button, #theme-toggle")) {
    button.addEventListener("pointerdown", event => {
      if (event.button === 0) event.preventDefault();
    });
  }
  el("minimize").onclick = () => run(window.minimize());
  el("maximize").onclick = () => run(window.toggleMaximize());
  el("close-window").onclick = requestWindowClose;
  run(listen("close-window-requested", requestWindowClose));
}
function applyInterfaceTheme(mode: "dark" | "light"): void {
  document.documentElement.dataset.theme = mode;
  setText(el("interface-theme-state"), mode === "light" ? "appearance.light" : "appearance.dark");
  const button = el("theme-toggle");
  const key = mode === "light" ? "appearance.switchDark" : "appearance.switchLight";
  button.dataset.i18nAriaLabel = key;
  button.dataset.i18nTitle = key;
  button.setAttribute("aria-label", t(key));
  button.setAttribute("title", t(key));
  button.setAttribute("aria-pressed", String(mode === "light"));
}
el("theme-toggle").onclick = () => run((async () => {
  const button = el<HTMLButtonElement>("theme-toggle");
  if (!booted || savingConfig) return;
  savingConfig = true;
  button.disabled = true;
  el<HTMLButtonElement>("save-settings").disabled = true;
  try {
    const uiTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    // Save only the quick toggle; keep any other unsaved form edits pending.
    const next: Config = { ...config, appearance: { ...config.appearance, uiTheme } };
    config = native ? await invoke<Config>("save_config", { config: next }) : next;
    field("ui-theme").checked = config.appearance.uiTheme === "light";
      updateDraft();
  } finally {
    savingConfig = false;
    button.disabled = false;
    el<HTMLButtonElement>("save-settings").disabled = !dirty;
  }
})());
async function boot(): Promise<void> {
  try {
    if (native) {
      const saved = await invoke<Config>("session_config");
      config = { ...defaults, ...saved, appearance: { ...defaults.appearance, ...saved.appearance }, interaction: { ...defaults.interaction, ...saved.interaction } };
    }
  } catch (error) {
    showError(error);
  }
  await setLanguage(config.language);
  loadFields();
  await document.fonts.ready;
  booted = true;
  renderDistributionMenu();
  newTab();
  run(refreshDistributions());
}
updateActions();
run(boot());
