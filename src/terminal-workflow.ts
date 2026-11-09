import type { Terminal } from "@xterm/xterm";
import type {
  Config,
  Distribution,
  LaunchProfile,
  SavedProfile,
} from "./settings";
import { t } from "./i18n";
import { refreshSelect, closeSelects } from "./select";
import { invoke } from "@tauri-apps/api/core";
import { terminalText, multilinePaste } from "./terminal-tools";
import { distributionIcon } from "./distribution-icons";

export interface WorkflowTab {
  key: string;
  profile: LaunchProfile;
  terminal: Terminal;
  title: HTMLElement;
  sessionId: number | null;
  closed: boolean;
  readOnly: boolean;
  copy(): Promise<void>;
  paste(): Promise<void>;
  start(): Promise<void>;
  rename(name: string): void;
  setReadOnly(value: boolean): void;
}
type Hooks = {
  config: () => Config;
  tabs: () => WorkflowTab[];
  active: () => WorkflowTab | undefined;
  distributions: () => Distribution[];
  open: (profile?: LaunchProfile, name?: string) => void;
  activate: (key: string) => void;
  close: (tab: WorkflowTab) => void;
  settings: (page: string) => void;
  search: () => void;
  changed: () => void;
  closeMenu: () => void;
  error: (error: unknown) => void;
  native: boolean;
};
type Command = {
  id: string;
  label: string;
  enabled: boolean;
  run: () => void | Promise<void>;
};
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

export function initializeTerminalWorkflow(hooks: Hooks) {
  let profiles: SavedProfile[] = [];
  let editingId: string | null = null;
  let exportBusy = false;
  let confirmationPending = false;
  let contextKey: string | null = null;
  let paletteCommands: Command[] = [];
  let paletteIndex = 0;
  const context = el("tab-context-menu");
  const palette = el<HTMLDialogElement>("command-palette");
  const query = el<HTMLInputElement>("command-query");
  const profileDialog = el<HTMLDialogElement>("profile-dialog");
  const defaultSelect = el<HTMLSelectElement>("config-default-profile");
  for (const id of [
    "rename-dialog",
    "paste-dialog",
    "close-others-dialog",
    "profile-dialog",
  ]) {
    const dialog = el<HTMLDialogElement>(id);
    dialog
      .querySelectorAll<HTMLButtonElement>("button[value=cancel]")
      .forEach((button) => {
        button.onclick = () => dialog.close("cancel");
      });
  }
  const focus = () => hooks.active()?.terminal.focus();
  const launch = (p: SavedProfile) =>
    hooks.open(
      {
        distribution: p.distribution,
        username: p.username,
        directory: p.directory,
      },
      p.name,
    );
  const run = (action: () => void | Promise<void>) => {
    void Promise.resolve().then(action).catch(hooks.error);
  };

  function closeContext() {
    context.hidden = true;
    contextKey = null;
  }
  function showDialog(id: string): Promise<boolean> {
    const dialog = el<HTMLDialogElement>(id);
    if (confirmationPending || document.querySelector("dialog[open]"))
      return Promise.resolve(false);
    confirmationPending = true;
    closeContext();
    hooks.closeMenu();
    closeSelects();
    return new Promise((resolve) => {
      dialog.addEventListener(
        "close",
        () => {
          confirmationPending = false;
          resolve(dialog.returnValue === "accept");
          focus();
        },
        { once: true },
      );
      dialog.returnValue = "cancel";
      dialog.showModal();
    });
  }
  async function confirmPaste(
    text: string,
    enabled: boolean,
  ): Promise<boolean> {
    if (!enabled || !multilinePaste(text)) return true;
    if (confirmationPending || document.querySelector("dialog[open]"))
      return false;
    const preview = el("paste-preview");
    preview.textContent = text.slice(0, 4096);
    const accepted = await showDialog("paste-dialog");
    preview.textContent = "";
    return accepted;
  }
  async function rename(tab: WorkflowTab) {
    if (document.querySelector("dialog[open]")) return;
    const input = el<HTMLInputElement>("tab-name");
    input.value = tab.title.textContent ?? "";
    if (await showDialog("rename-dialog"))
      if (!tab.closed) tab.rename(input.value.trim());
  }
  async function closeOthers(tab: WorkflowTab) {
    const others = hooks.tabs().filter((other) => other.key !== tab.key);
    if (!others.length) return;
    el("close-others-message").textContent = t("workflow.closeOthersMessage", {
      count: others.length,
    });
    if (
      hooks.config().interaction.warnOnClose &&
      !(await showDialog("close-others-dialog"))
    )
      return;
    if (!tab.closed)
      for (const other of others) if (!other.closed) hooks.close(other);
  }
  async function exportText(tab: WorkflowTab) {
    if (exportBusy || tab.closed) return;
    exportBusy = true;
    try {
      let text: string;
      try {
        text = terminalText(tab.terminal.buffer.active);
      } catch {
        throw new Error(t("workflow.exportTooLarge"));
      }
      if (!hooks.native) throw new Error(t("settings.saveUnavailable"));
      await invoke("export_terminal_text", { text });
    } finally {
      exportBusy = false;
    }
  }
  function tabCommands(tab: WorkflowTab | undefined): Command[] {
    if (!tab || tab.closed) return [];
    return [
      {
        id: "rename",
        label: t("workflow.rename"),
        enabled: true,
        run: () => rename(tab),
      },
      {
        id: "duplicate",
        label: t("workflow.duplicate"),
        enabled: hooks.tabs().length < 32,
        run: () => hooks.open({ ...tab.profile }, tab.title.dataset.customName),
      },
      {
        id: "closeOthers",
        label: t("workflow.closeOthers"),
        enabled: hooks.tabs().length > 1,
        run: () => closeOthers(tab),
      },
      {
        id: "readOnly",
        label: t(tab.readOnly ? "workflow.unlock" : "workflow.readOnly"),
        enabled: true,
        run: () => tab.setReadOnly(!tab.readOnly),
      },
      {
        id: "clear",
        label: t("workflow.clear"),
        enabled: tab.terminal.buffer.active.type === "normal",
        run: () => {
          tab.terminal.clear();
          focus();
        },
      },
      {
        id: "export",
        label: t("workflow.export"),
        enabled: !exportBusy,
        run: () => exportText(tab),
      },
    ];
  }
  function commands(): Command[] {
    const tab = hooks.active();
    return [
      {
        id: "new",
        label: t("common.newTab"),
        enabled: hooks.tabs().length < 32,
        run: () => hooks.open(),
      },
      ...hooks.config().profiles.map((p) => ({
        id: `profile-${p.id}`,
        label: `${t("workflow.openProfile")} · ${p.name}`,
        enabled: hooks.tabs().length < 32,
        run: () => launch(p),
      })),
      ...hooks.distributions().map((d) => ({
        id: `distribution-${d.name}`,
        label: `${t("common.newTab")} · ${d.name}`,
        enabled: hooks.tabs().length < 32,
        run: () =>
          hooks.open({
            distribution: d.name,
            username: null,
            directory: "~",
          }),
      })),
      ...tabCommands(tab),
      {
        id: "manageProfiles",
        label: t("workflow.profiles"),
        enabled: true,
        run: () => {
          hooks.settings("general");
          el("profiles-title").scrollIntoView({ block: "start" });
        },
      },
      {
        id: "copy",
        label: t("common.copy"),
        enabled: !!tab?.terminal.hasSelection(),
        run: () => tab?.copy(),
      },
      {
        id: "paste",
        label: t("common.paste"),
        enabled: tab?.sessionId != null && !tab.readOnly,
        run: () => tab?.paste(),
      },
      {
        id: "search",
        label: t("common.search"),
        enabled: !!tab,
        run: hooks.search,
      },
      {
        id: "reconnect",
        label: t("common.reconnect"),
        enabled: !!tab && tab.sessionId === null,
        run: () => tab?.start(),
      },
      ...[
        "general",
        "appearance",
        "management",
        "installation",
        "wsl",
        "shortcuts",
      ].map((page) => ({
        id: `settings-${page}`,
        label: t(page === "wsl" ? "common.wslSettings" : `nav.${page}`),
        enabled: true,
        run: () => hooks.settings(page),
      })),
    ];
  }
  function renderPalette() {
    const normalize = (s: string) =>
      s
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase();
    const terms = normalize(query.value).split(/\s+/).filter(Boolean);
    paletteCommands = commands()
      .filter(
        (command) =>
          command.enabled &&
          terms.every((term) => normalize(command.label).includes(term)),
      )
      .slice(0, 100);
    paletteIndex = Math.max(
      0,
      Math.min(paletteIndex, paletteCommands.length - 1),
    );
    const list = el("command-results");
    list.replaceChildren();
    for (const [index, command] of paletteCommands.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `command-result-${index}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === paletteIndex));
      button.textContent = command.label;
      button.onclick = () => {
        palette.close();
        run(command.run);
      };
      list.append(button);
    }
    query.setAttribute("aria-expanded", "true");
    if (paletteCommands.length)
      query.setAttribute(
        "aria-activedescendant",
        `command-result-${paletteIndex}`,
      );
    else query.removeAttribute("aria-activedescendant");
    el("command-empty").hidden = paletteCommands.length > 0;
    list.children[paletteIndex]?.scrollIntoView({ block: "nearest" });
  }
  function openPalette() {
    if (document.querySelector("dialog[open]")) return;
    closeContext();
    hooks.closeMenu();
    closeSelects();
    query.value = "";
    paletteIndex = 0;
    renderPalette();
    palette.showModal();
    query.focus();
  }
  query.oninput = () => {
    paletteIndex = 0;
    renderPalette();
  };
  query.onkeydown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      paletteIndex =
        (paletteIndex +
          (event.key === "ArrowDown" ? 1 : -1) +
          paletteCommands.length) %
        Math.max(1, paletteCommands.length);
      renderPalette();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = paletteCommands[paletteIndex];
      if (command) {
        palette.close();
        run(command.run);
      }
    }
  };
  palette.addEventListener("close", () => {
    query.value = "";
    el("command-results").replaceChildren();
    focus();
  });
  el("command-close").onclick = () => palette.close();
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.ctrlKey &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (palette.open) palette.close();
        else if (!document.querySelector("dialog[open]")) openPalette();
      }
      if (event.key === "Escape" && !context.hidden) {
        event.preventDefault();
        closeContext();
        focus();
      }
    },
    true,
  );
  document.addEventListener("pointerdown", (event) => {
    if (!context.contains(event.target as Node)) closeContext();
  });
  window.addEventListener("resize", closeContext);
  function showContext(key: string, x: number, y: number) {
    const tab = hooks.tabs().find((tab) => tab.key === key);
    if (!tab) return;
    hooks.activate(key);
    hooks.closeMenu();
    closeSelects();
    contextKey = key;
    context.replaceChildren();
    for (const command of tabCommands(tab)) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = command.label;
      button.disabled = !command.enabled;
      button.dataset.action = command.id;
      button.onclick = () => {
        closeContext();
        run(command.run);
      };
      context.append(button);
    }
    context.hidden = false;
    context.style.left = `${Math.max(4, Math.min(x, window.innerWidth - context.offsetWidth - 4))}px`;
    context.style.top = `${Math.max(4, Math.min(y, window.innerHeight - context.offsetHeight - 4))}px`;
    context.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }
  context.onkeydown = (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [
      ...context.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
    ]?.focus();
  };
  el("tabs").addEventListener("contextmenu", (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-tab]",
    );
    if (!tab || tab.dataset.tab === "settings") return;
    event.preventDefault();
    showContext(tab.dataset.tab!, event.clientX, event.clientY);
  });
  el("tabs").addEventListener("keydown", (event) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;
    const tab = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-tab]",
    );
    if (!tab || tab.dataset.tab === "settings") return;
    event.preventDefault();
    const r = tab.getBoundingClientRect();
    showContext(tab.dataset.tab!, r.left, r.bottom);
  });

  function renderProfiles() {
    const selected = defaultSelect.value;
    defaultSelect.replaceChildren(
      new Option(t("workflow.customSession"), ""),
      ...profiles.map((p) => new Option(p.name, p.id)),
    );
    defaultSelect.value = profiles.some((p) => p.id === selected)
      ? selected
      : "";
    refreshSelect(defaultSelect.id);
    const list = el("profiles-list");
    list.replaceChildren();
    for (const profile of profiles) {
      const card = document.createElement("div");
      card.className = "setting-card profile-card";
      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = profile.name;
      const detail = document.createElement("small");
      detail.textContent = `${profile.distribution} · ${profile.username ?? t("workflow.defaultUser")} · ${profile.directory}`;
      text.append(name, detail);
      const actions = document.createElement("span");
      actions.className = "profile-actions";
      for (const [label, callback] of [
        [t("workflow.edit"), () => editProfile(profile)],
        [
          t("workflow.remove"),
          () => {
            profiles = profiles.filter((p) => p.id !== profile.id);
            renderProfiles();
            hooks.changed();
          },
        ],
      ] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.onclick = callback;
        actions.append(button);
      }
      card.append(text, actions);
      list.append(card);
    }
    el<HTMLButtonElement>("profile-add").disabled = profiles.length >= 32;
  }
  function editProfile(profile?: SavedProfile) {
    if (document.querySelector("dialog[open]")) return;
    editingId = profile?.id ?? null;
    el<HTMLInputElement>("profile-name").value = profile?.name ?? "";
    el<HTMLInputElement>("profile-user").value = profile?.username ?? "";
    el<HTMLInputElement>("profile-directory").value = profile?.directory ?? "~";
    const select = el<HTMLSelectElement>("profile-distribution");
    const selected = profile?.distribution ?? hooks.config().distribution;
    select.replaceChildren(
      ...[
        ...new Set([selected, ...hooks.distributions().map((d) => d.name)]),
      ].map((d) => new Option(d, d)),
    );
    select.value = selected;
    refreshSelect(select.id);
    profileDialog.showModal();
  }
  el("profile-add").onclick = () => editProfile();
  el<HTMLFormElement>("profile-editor").onsubmit = (event) => {
    event.preventDefault();
    const name = el<HTMLInputElement>("profile-name").value.trim();
    const distribution = el<HTMLSelectElement>("profile-distribution").value;
    const username = el<HTMLInputElement>("profile-user").value.trim() || null;
    const directory = el<HTMLInputElement>("profile-directory").value.trim();
    if (
      !name ||
      [name, distribution, username ?? "user", directory].some(
        (s) => !s || /[\u0000-\u001f\u007f-\u009f]/.test(s),
      ) ||
      [distribution, username ?? "user", directory].some((s) =>
        s.startsWith("-"),
      )
    ) {
      hooks.error(t("workflow.invalidProfile"));
      return;
    }
    const saved: SavedProfile = {
      id: editingId ?? crypto.randomUUID(),
      name,
      distribution,
      username,
      directory,
    };
    profiles = editingId
      ? profiles.map((p) => (p.id === editingId ? saved : p))
      : [...profiles, saved];
    profileDialog.close();
    renderProfiles();
    hooks.changed();
  };
  profileDialog.addEventListener("close", () => {
    closeSelects();
    el<HTMLFormElement>("profile-editor").reset();
  });
  el("workflow-palette").onclick = openPalette;
  for (const id of ["clear", "export", "readOnly"])
    el(`workflow-${id}`).onclick = () => {
      const command = tabCommands(hooks.active()).find((c) => c.id === id);
      if (command?.enabled) run(command.run);
    };
  function refresh() {
    if (
      contextKey &&
      !hooks.tabs().some((t) => t.key === contextKey && !t.closed)
    )
      closeContext();
    if (palette.open) renderPalette();
    for (const command of tabCommands(hooks.active())) {
      const button = document.getElementById(
        `workflow-${command.id}`,
      ) as HTMLButtonElement | null;
      if (button) {
        button.textContent = command.label;
        button.disabled = !command.enabled;
      }
    }
    if (!hooks.active())
      for (const id of ["clear", "export", "readOnly"])
        el<HTMLButtonElement>(`workflow-${id}`).disabled = true;
  }
  return {
    confirmPaste,
    refresh,
    draftProfiles: () => structuredClone(profiles),
    loadFields: () => {
      profiles = structuredClone(hooks.config().profiles);
      defaultSelect.value = "";
      renderProfiles();
      defaultSelect.value = hooks.config().defaultProfileId ?? "";
      refreshSelect(defaultSelect.id);
    },
    renderProfileMenu: () => {
      const group = el("saved-profile-menu");
      const focused = (document.activeElement as HTMLElement | null)?.dataset
        .launchProfile;
      group.replaceChildren();
      for (const profile of hooks.config().profiles) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "distribution-menu-item";
        const image = document.createElement("img");
        image.src = distributionIcon(profile.distribution);
        image.alt = "";
        image.className = "tab-logo";
        const name = document.createElement("span");
        name.className = "distribution-name";
        name.textContent = profile.name;
        const detail = document.createElement("span");
        detail.className = "distribution-detail";
        detail.textContent =
          profile.id === hooks.config().defaultProfileId
            ? t("common.default")
            : profile.distribution;
        button.append(image, name, detail);
        button.title = `${profile.distribution} · ${profile.directory}`;
        button.dataset.launchProfile = profile.id;
        button.disabled = hooks.tabs().length >= 32;
        button.onclick = () => launch(profile);
        group.append(button);
        if (focused === profile.id && !el("terminal-menu").hidden)
          button.focus({ preventScroll: true });
      }
    },
  };
}
