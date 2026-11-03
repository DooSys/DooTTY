import { invoke } from "@tauri-apps/api/core";
import { currentLanguage, onLanguageChanged, setText, t } from "./i18n";

export type StableRelease = { tag: string; version: string; publishedAt: string | null; url: string };
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function parts(value: string): number[] | null {
  if (!/^v?\d+\.\d+\.\d+(?:\.\d+)?$/.test(value)) return null;
  const values = value.replace(/^v/, "").split(".").map(Number);
  if (values.some(value => !Number.isSafeInteger(value) || value > 0xffffffff)) return null;
  while (values.length < 4) values.push(0);
  return values;
}
export function compareVersions(installed: string, available: string): number | null {
  const left = parts(installed), right = parts(available);
  if (!left || !right) return null;
  for (let index = 0; index < 4; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function initializeWslUpdates(options: { native: boolean; isBusy: () => boolean; error: (error: unknown) => void }): {
  refreshControls: () => void;
  canUpdate: () => boolean;
  confirmation: () => string;
  refreshInstalled: () => Promise<void>;
  visit: () => void;
} {
  let visited = false;
  let installed: string | null = null;
  let release: StableRelease | null = null;
  let installedError: string | null = null;
  let remoteError: string | null = null;
  let checking = false;
  let checkedAt: Date | null = null;

  function canUpdate(): boolean {
    return !checking && !remoteError && !installedError && installed !== null && release !== null && compareVersions(installed, release.version) === -1;
  }
  function refreshControls(): void {
    const busy = options.isBusy();
    el<HTMLButtonElement>("wsl-check-updates").disabled = !options.native || busy || checking;
    el<HTMLButtonElement>("wsl-release-notes").disabled = !options.native || busy || release === null;
    el<HTMLButtonElement>("wsl-update").disabled = !options.native || busy || !canUpdate();
  }
  function render(): void {
    el("wsl-check-updates").classList.toggle("syncing", checking);
    el("wsl-check-updates").setAttribute("aria-busy", String(checking));
    el("wsl-installed-version").textContent = installed ?? "—";
    el("wsl-available-version").textContent = release?.version ?? "—";
    const comparison = installed && release ? compareVersions(installed, release.version) : null;
    const status = checking ? "updates.checking" : !checkedAt ? "updates.unchecked"
      : installedError || remoteError ? "updates.cannotCompare"
      : comparison === -1 ? "updates.updateAvailable" : comparison === 0 ? "updates.upToDate"
      : comparison === 1 ? "updates.newerInstalled" : "updates.cannotCompare";
    setText(el("wsl-update-status"), status);
    for (const [id, error, key] of [["wsl-installed-error", installedError, "updates.installedError"], ["wsl-release-error", remoteError, "updates.remoteError"]] as const) {
      el(id).hidden = !error;
      if (error) setText(el(id), key, { error });
    }
    const date = el("wsl-update-date");
    date.hidden = !checkedAt;
    if (checkedAt) setText(date, "updates.checkedAt", { date: checkedAt.toLocaleString(currentLanguage()) });
    refreshControls();
  }
  async function refreshInstalled(): Promise<void> {
    try {
      const info = await invoke<{version:string;details:string;status:string|null;statusError:string|null}>("wsl_system_info");
      const version = info.version;
      el("wsl-version-details").textContent = info.details;
      el("wsl-current-status").textContent = info.status ?? info.statusError ?? "—";
      if (!version || !parts(version)) throw new Error(t("updates.unrecognizedVersion"));
      installed = version;
      installedError = null;
    } catch (error) {
      installedError = String(error);
    }
    render();
  }
  async function check(): Promise<void> {
    if (!options.native || checking || options.isBusy()) return;
    checking = true; visited = true;
    installedError = null; remoteError = null;
    render();
    await Promise.all([
      refreshInstalled(),
      (async () => {
        try {
          const latest = await invoke<StableRelease>("wsl_latest_release");
          if (!latest || !parts(latest.version)) throw new Error(t("updates.unrecognizedVersion"));
          release = latest;
        } catch (error) { remoteError = String(error); }
        render();
      })(),
    ]);
    checking = false;
    checkedAt = new Date();
    render();
  }
  el("wsl-check-updates").onclick = () => { void check(); };
  el("wsl-release-notes").onclick = () => {
    if (release) void invoke("open_wsl_release_notes", { tag: release.tag }).catch(options.error);
  };
  onLanguageChanged(render);
  render();
  return {
    refreshControls, canUpdate, refreshInstalled,
    visit: () => { if (!visited) void check(); },
    confirmation: () => t("updates.confirmUpdate", { installed: installed ?? "—", available: release?.version ?? "—" }),
  };
}
