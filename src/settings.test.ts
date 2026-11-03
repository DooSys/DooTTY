import { expect, it } from "vitest";
import { defaults, themes, formatBytes, createProfile } from "./settings";
it("distinguishes missing disk metadata, zero size and large files", () => {
  expect(formatBytes(null)).toContain("inaccessible");
  expect(formatBytes(0)).toBe("0 octets");
  expect(formatBytes(1024 ** 3)).toBe("1 Gio");
  expect(formatBytes(1024 ** 4)).toBe("1 Tio");
});
it("defines complete independent terminal color schemes", () => {
  expect(Object.keys(themes)).toHaveLength(5);
  expect(Object.keys(themes)).toContain(defaults.appearance.theme);
  for (const theme of Object.values(themes)) {
    for (const field of [
      "background",
      "foreground",
      "cursor",
      "black",
      "red",
      "green",
      "blue",
      "brightWhite",
    ]) {
      expect(theme[field as keyof typeof theme]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  }
});

it("uses each other distribution's default user and home without changing the saved profile", () => {
  const config = structuredClone(defaults);
  config.username = "developer";
  config.directory = "/home/developer/projets";
  expect(createProfile(config, "Ubuntu")).toEqual({
    distribution: "Ubuntu",
    username: null,
    directory: "~",
  });
  expect(config.username).toBe("developer");
  expect(config.distribution).toBe("Debian");
});
it("captures the launch settings for an existing tab independently of later edits", () => {
  const config = structuredClone(defaults);
  config.username = "developer";
  config.directory = "/home/developer/projets";
  const profile = createProfile(config);
  config.distribution = "Ubuntu";
  config.username = null;
  config.directory = "~";
  expect(profile).toEqual({
    distribution: "Debian",
    username: "developer",
    directory: "/home/developer/projets",
  });
});
