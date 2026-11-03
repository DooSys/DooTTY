import i18next from "i18next";

type Catalog = { _meta: { name: string }; [key: string]: unknown };
const files = import.meta.glob<Catalog>("./locales/*.json", { eager: true, import: "default" });
const catalogs = Object.fromEntries(Object.entries(files).map(([path, catalog]) => [
  path.split("/").pop()!.replace(/\.json$/, ""), catalog,
]));
export const languages = Object.entries(catalogs).map(([code, catalog]) => ({ code, name: catalog._meta.name }));

// Resources are bundled. No browser detector, HTTP backend or translation service.
void i18next.init({
  lng: "fr", fallbackLng: "en", supportedLngs: languages.map(language => language.code),
  resources: Object.fromEntries(Object.entries(catalogs).map(([code, catalog]) => [code, { translation: catalog }])),
  initAsync: false,
  interpolation: { escapeValue: false }, // Output goes exclusively into textContent / attributes, never innerHTML.
});

export function t(key: string, values: Record<string, unknown> = {}): string {
  return String(i18next.t(key, values));
}
export function currentLanguage(): string { return i18next.resolvedLanguage ?? "en"; }
export async function setLanguage(language: string): Promise<void> {
  await i18next.changeLanguage(catalogs[language] ? language : "en");
}

const parameters = new WeakMap<HTMLElement, Record<string, unknown>>();
export function setText(element: HTMLElement, key: string, values: Record<string, unknown> = {}): void {
  element.dataset.i18n = key;
  parameters.set(element, values);
  element.textContent = t(key, values);
}
export function translateDocument(): void {
  document.documentElement.lang = currentLanguage();
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach(element => {
    element.textContent = t(element.dataset.i18n!, parameters.get(element));
  });
  for (const attribute of ["aria-label", "title", "placeholder", "alt"]) {
    document.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`).forEach(element => {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)!));
    });
  }
}

export function onLanguageChanged(callback: () => void): () => void {
  i18next.on("languageChanged", callback);
  return () => i18next.off("languageChanged", callback);
}
