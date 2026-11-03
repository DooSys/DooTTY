import { Channel, invoke } from "@tauri-apps/api/core";
import type { Distribution } from "./settings";
import { closeSelects, refreshSelect } from "./select";
import { distributionIcon } from "./distribution-icons";
import { t, setText, onLanguageChanged, currentLanguage } from "./i18n";
import { initializeWslUpdates } from "./wsl-updates";
import { OutputDecoder } from "./output-decoder";
import { singleFlight } from "./resources";

type Action =
  | { action: "update" | "restart" }
  | { action: "terminate" | "setDefault"; distribution: string }
  | { action: "export"; distribution: string; path: string }
  | { action: "import"; name: string; path: string; location: string }
  | { action: "install"; name: string };
type Output = { kind: "data"; stream: "stdout" | "stderr"; bytes: number[]; truncated: boolean } | { kind: "complete" } | { kind: "note"; text: string };
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => element<HTMLInputElement>(id).value.trim();

export function initializeWslManagement(options: {
  native: boolean;
  distributions: () => Distribution[];
  refreshDistributions: () => Promise<void>;
  launch: (distribution: string) => void;
  prepareStop: (distribution: string | null) => () => void;
  restart: (distribution: string) => Promise<void>;
  prepareRestartAll: () => () => Promise<void>;
  error: (error: unknown) => void;
}): { refresh: () => Promise<void>; visit: () => void; visitInstallation: () => void } {
  let busy = false;
  let catalogueChecking = false;
  let catalogueVisited = false;
  let catalogue: { name: string; label: string }[] = [];
  let catalogueDate: Date | null = null;
  let catalogueError: string | null = null;
  let running: Set<string> | null = null;
  let pending: (() => void) | null = null;
  let adminRetry = false;
  const dialog = element<HTMLDialogElement>("wsl-action-dialog");
  const state = element("wsl-operation-state");
  const log = element("wsl-operation-log");
  const updates = initializeWslUpdates({ native: options.native, isBusy: () => busy || catalogueChecking, error: options.error });

  function disabled(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-section="management"] button, [data-section="installation"] button').forEach(button => {
      button.disabled = busy || catalogueChecking || !options.native;
    });
    const install = element<HTMLSelectElement>("wsl-install-name");
    install.disabled = busy || catalogueChecking || !options.native || !install.value;
    element<HTMLButtonElement>("wsl-install").disabled ||= !install.value;
    refreshSelect(install.id);
    updates.refreshControls();
    element<HTMLButtonElement>("wsl-admin-retry").hidden = !adminRetry;
  }
  function render(): void {
    const list = element("wsl-distributions");
    const select = element<HTMLSelectElement>("wsl-export-distribution");
    const selected = select.value;
    select.replaceChildren();
    list.replaceChildren();
    for (const distribution of options.distributions()) {
      select.add(new Option(distribution.name, distribution.name));
      const card = document.createElement("div");
      card.className = "distribution-card";
      const heading = document.createElement("div");
      heading.className = "distribution-card-heading";
      const name = document.createElement("strong");
      name.textContent = distribution.name;
      const identity = document.createElement("span");
      identity.className = "distribution-identity";
      const icon = document.createElement("img");
      icon.src = distributionIcon(distribution.name);
      icon.alt = "";
      identity.append(icon, name);
      const status = document.createElement("span");
      status.className = "distribution-state";
      status.classList.toggle("running", !!running?.has(distribution.name));
      status.textContent = [running === null ? t("management.stateUnknown") : running.has(distribution.name) ? t("management.running") : t("management.stopped"),
        distribution.version ? `WSL ${distribution.version}` : "", distribution.isDefault ? t("management.default") : ""].filter(Boolean).join(" · ");
      heading.append(identity, status);
      const actions = document.createElement("div");
      actions.className = "management-actions";
      function button(label: string, action: () => void): void {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.onclick = action;
        actions.append(button);
      }
      button(t("management.openTerminal"), () => options.launch(distribution.name));
      button(t("management.files"), () => { void invoke("open_distribution_files", { distribution: distribution.name }).catch(options.error); });
      button(t("management.stop"), () => request({action:"terminate", distribution:distribution.name}));
      button(t("management.restart"), () => request({action:"terminate", distribution:distribution.name}, true));
      if (!distribution.isDefault) button(t("management.setDefault"), () => request({action:"setDefault", distribution:distribution.name}));
      card.append(heading, actions);
      list.append(card);
    }
    if (Array.from(select.options).some(option => option.value === selected)) select.value = selected;
    refreshSelect(select.id);
    renderCatalogue();
    disabled();
  }

  async function loadOverview(): Promise<void> {
    if (!options.native) {
      setText(element("wsl-overview-state"), "management.unavailable");
      render(); return;
    }
    setText(element("wsl-overview-state"), "management.loading");
    try {
      const [overview] = await Promise.all([
        invoke<{running:string[]}>("wsl_overview"), options.refreshDistributions(),
      ]);
      running = new Set(overview.running);
      setText(element("wsl-overview-state"), "management.defaultHint");
    } catch (error) {
      running = null;
      element("wsl-overview-state").removeAttribute("data-i18n");
      element("wsl-overview-state").textContent = String(error);
    }
    render();
  }
  const refresh = singleFlight(loadOverview);

  function renderCatalogue(): void {
    const select = element<HTMLSelectElement>("wsl-install-name");
    const selected = select.value;
    const available = catalogue.filter(entry => !options.distributions().some(d => d.name.toLowerCase() === entry.name.toLowerCase()));
    select.replaceChildren(...available.map(entry => new Option(`${entry.label} · ${entry.name}`, entry.name)));
    if (!available.length) select.add(new Option(t(catalogueChecking ? "management.catalogChecking" : catalogueDate ? "management.catalogEmpty" : "management.catalogUnchecked"), ""));
    else if (available.some(entry => entry.name === selected)) select.value = selected;
    const date = element("wsl-catalogue-date");
    if (catalogueChecking) setText(date, "management.catalogChecking");
    else if (catalogueDate) setText(date, "management.catalogSyncedAt", { date: catalogueDate.toLocaleString(currentLanguage()) });
    else setText(date, options.native ? "management.catalogUnchecked" : "management.catalogUnavailable");
    const button = element("wsl-catalogue-refresh");
    button.classList.toggle("syncing", catalogueChecking);
    button.setAttribute("aria-busy", String(catalogueChecking));
    element("wsl-catalogue-error").hidden = !catalogueError;
    if (catalogueError) setText(element("wsl-catalogue-error"), "management.catalogError", { error: catalogueError });
    disabled();
  }
  async function syncCatalogue(): Promise<void> {
    if (!options.native || busy || catalogueChecking) return;
    catalogueVisited = true;
    catalogueChecking = true;
    catalogueError = null;
    renderCatalogue();
    try {
      const fresh = await invoke<{ name: string; label: string }[]>("wsl_online_catalogue");
      if (!Array.isArray(fresh) || !fresh.length || fresh.some(entry => !entry.name || !entry.label)) throw new Error(t("management.catalogEmpty"));
      catalogue = fresh;
      catalogueDate = new Date();
    } catch (error) { catalogueError = String(error); }
    finally { catalogueChecking = false; renderCatalogue(); }
  }
  element("wsl-catalogue-refresh").onclick = () => { void syncCatalogue(); };
  element("wsl-install-name").addEventListener("change", disabled);

  async function execute(request: Action, command: string, restart: boolean, elevated = false): Promise<void> {
    if (busy || catalogueChecking) return;
    adminRetry = false;
    busy = true; disabled();
    setText(state, "management.operationRunning");
    element("wsl-operation-output").hidden = false;
    log.removeAttribute("data-i18n");
    state.dataset.state = "running";
    const streams = {stdout:"", stderr:"", notes:""};
    const decoders = { stdout: new OutputDecoder(), stderr: new OutputDecoder() };
    let outputFrame = 0;
    let completed!: () => void;
    const outputComplete = new Promise<void>(resolve => { completed = resolve; });
    let truncated = false;
    const output = new Channel<Output>();
    const draw = () => {
      log.textContent = command + "\n\n" + streams.stdout + (streams.stderr ? "\n" + streams.stderr : "")
        + streams.notes
        + (truncated ? "\n" + t("management.outputLimited") : "");
      log.scrollTop = log.scrollHeight;
    };
    output.onmessage = message => {
      if (message.kind === "note") { streams.notes += message.text; draw(); return; }
      if (message.kind === "complete") {
        streams.stdout += decoders.stdout.decode([], true);
        streams.stderr += decoders.stderr.decode([], true);
        completed(); return;
      }
      streams[message.stream] += decoders[message.stream].decode(message.bytes).replace(/\r(?!\n)/g, "\n");
      truncated ||= message.truncated;
      if (!outputFrame) outputFrame = requestAnimationFrame(() => { outputFrame = 0; draw(); });
    };
    draw();
    log.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const resumeAll = request.action === "restart" ? options.prepareRestartAll() : undefined;
    const restoreStop = request.action === "restart"
      ? options.prepareStop(null)
      : request.action === "terminate" ? options.prepareStop(request.distribution) : undefined;
    try {
      if (elevated) log.textContent += "\n" + t("management.adminConsole");
      const result = elevated
        ? await invoke<{success:boolean;code:number|null}>("update_wsl_elevated")
        : await invoke<{success:boolean;code:number|null}>("run_wsl_action", {request, output});
      if (!elevated) { await outputComplete; cancelAnimationFrame(outputFrame); outputFrame = 0; draw(); }
      if (!result.success) throw new Error(t("management.commandFailed", { code: result.code ?? t("common.unknown") }));
      if (restart && "distribution" in request) {
        log.textContent += "\n" + t("management.relaunching");
        await options.restart(request.distribution);
      }
      if (resumeAll) await resumeAll();
      setText(state, "management.completed");
      state.dataset.state = "success";
      if (!streams.stdout && !streams.stderr && !streams.notes) log.textContent += "\n" + t("management.noOutput");
    } catch (error) {
      adminRetry = request.action === "update" && !elevated;
      cancelAnimationFrame(outputFrame); outputFrame = 0;
      if (!elevated) {
        streams.stdout += decoders.stdout.decode([], true);
        streams.stderr += decoders.stderr.decode([], true);
        draw();
      }
      restoreStop?.();
      setText(state, "management.failed");
      state.dataset.state = "error";
      log.textContent += `\n\n${String(error)}`;
    } finally {
      output.onmessage = () => {};
      busy = false; disabled();
      if (request.action === "update") await updates.refreshInstalled();
      await refresh();
    }
  }

  function request(action: Action, restart = false, elevated = false): void {
    if (busy || catalogueChecking || !options.native) return;
    if (action.action === "update" && !elevated && !updates.canUpdate()) {
      options.error(t("updates.checkFirst")); return;
    }
    const argumentsForDisplay: Record<string,string[]> = {
      update:["--update","--web-download"], restart:["--shutdown"],
    };
    let args = argumentsForDisplay[action.action];
    let description = "";
    let title = t("management.confirmHeading");
    if ("distribution" in action) {
      if (!action.distribution) { options.error(t("management.selectDistribution")); return; }
      args = [action.action === "setDefault" ? "--set-default" : action.action === "export" ? "--export" : "--terminate", action.distribution];
      if (action.action === "export") {
        if (!action.path) { options.error(t("management.enterExportPath")); return; }
        args.push(action.path);
        description = t("management.exportConfirmation", { distribution: action.distribution, path: action.path });
      } else if (action.action === "setDefault") {
        description = t("management.defaultConfirmation", { distribution: action.distribution });
      } else {
        title = t(restart ? "management.restartTitle" : "management.stopTitle", { distribution: action.distribution });
        description = t(restart ? "management.restartConfirmation" : "management.stopConfirmation", { distribution: action.distribution });
      }
    }
    if (action.action === "restart") {
      title = t("management.restartWslTitle");
      description = t("management.restartWslConfirmation");
    }
    if (action.action === "update") description = updates.confirmation();
    if (elevated) description = t("management.adminConfirmation");
    if (action.action === "import") {
      if (!action.name || !action.path || !action.location) { options.error(t("management.enterImportFields")); return; }
      args = ["--import",action.name,action.location,action.path,"--version","2"];
      description = t("management.importConfirmation", { name: action.name, location: action.location, path: action.path });
    }
    if (action.action === "install") {
      if (!catalogue.some(entry => entry.name === action.name)) { options.error(t("management.enterInstallName")); return; }
      args = ["--install","--distribution",action.name,"--no-launch"];
      description = t("management.installConfirmation", { name: action.name });
    }
    const command = "wsl.exe " + args.map(arg => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(" ");
    element("wsl-action-title").removeAttribute("data-i18n");
    element("wsl-action-title").textContent = title;
    element("wsl-action-description").textContent = description;
    element("wsl-action-command").textContent = command + (restart || action.action === "restart" ? "\n" + t("management.restartCommandHint") : "");
    pending = () => { void execute(action, command, restart, elevated); };
    closeSelects(); dialog.showModal();
  }
  dialog.addEventListener("close", () => { pending = null; });
  element("wsl-action-cancel").onclick = () => { pending = null; dialog.close(); };
  element("wsl-action-confirm").onclick = () => { const action = pending; pending = null; dialog.close(); action?.(); };
  element("wsl-refresh").onclick = () => { void refresh(); };
  element("wsl-admin-retry").onclick = () => request({ action: "update" }, false, true);
  document.querySelectorAll<HTMLButtonElement>("[data-wsl-action]").forEach(button => {
    button.onclick = () => request({action:button.dataset.wslAction} as Action);
  });
  element("wsl-export").onclick = () => request({action:"export", distribution:value("wsl-export-distribution"), path:value("wsl-export-path")});
  element("wsl-import").onclick = () => request({action:"import", name:value("wsl-import-name"), path:value("wsl-import-path"), location:value("wsl-import-location")});
  element("wsl-install").onclick = () => request({action:"install", name:value("wsl-install-name")});
  disabled();
  onLanguageChanged(render);
  return {refresh, visit:updates.visit, visitInstallation: () => { if (!catalogueVisited) void syncCatalogue(); }};
}
