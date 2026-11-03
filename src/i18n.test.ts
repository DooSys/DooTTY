import { afterEach, expect, it } from "vitest";
import { currentLanguage, languages, setLanguage, t } from "./i18n";
import { formatBytes } from "./settings";

afterEach(async () => { await setLanguage("fr"); });

it("switches languages and formats sizes without changing substituted values", async () => {
  expect(languages.map(language => language.code)).toEqual(expect.arrayContaining(["en", "fr"]));
  await setLanguage("en");
  expect(currentLanguage()).toBe("en");
  expect(t("common.save")).toBe("Save");
  expect(t("management.restartTitle", { distribution: "Debian test" })).toBe("Restart Debian test?");
  expect(t("appearance.currentFont", { font: "<custom>&font" })).toBe("Current setting · <custom>&font");
  expect(formatBytes(1024 ** 3)).toBe("1 GiB");
  await setLanguage("fr");
  expect(t("common.save")).toBe("Enregistrer");
  expect(formatBytes(1024 ** 3)).toBe("1 Gio");
});

it("falls back to English for unavailable locales", async () => {
  await setLanguage("xx");
  expect(currentLanguage()).toBe("en");
  expect(t("management.stop")).toBe("Stop");
});
