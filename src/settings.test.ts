import { expect, it } from "vitest";
import { defaults, sameConfig, themes, terminalTheme, formatBytes, createProfile } from "./settings";
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

it("keeps every console palette independent of the app theme", () => {
  for (const name of Object.keys(themes)) {
    for (const uiTheme of ["dark", "light"] as const) {
      const appearance = { ...defaults.appearance, theme: name, uiTheme };
      expect(terminalTheme(appearance)).toBe(themes[name]);
    }
  }
  expect(terminalTheme({ theme: "unknown" })).toBe(themes.campbell);
});

it("launches a saved default profile without leaking its metadata into WSL arguments", () => {
  const config = structuredClone(defaults);
  config.profiles=[{id:"work",name:"Work",distribution:"Ubuntu",username:"developer",directory:"/home/developer/project one"}];
  config.defaultProfileId="work";
  expect(createProfile(config)).toEqual({distribution:"Ubuntu",username:"developer",directory:"/home/developer/project one"});
  expect(createProfile(config,"Debian")).toEqual({distribution:"Debian",username:null,directory:"~"});
  config.defaultProfileId=null;
  expect(createProfile(config).distribution).toBe("Debian");
});

it("compares settings by value regardless of IPC object key order", () => {
  const config = structuredClone(defaults);
  config.profiles = [{id: "work", name: "Work", distribution: "Debian", username: null, directory: "~"}];
  const reordered = JSON.parse(JSON.stringify(config, (_key, value) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse())
      : value,
  ));
  expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(config));
  expect(sameConfig(config, reordered)).toBe(true);
  reordered.profiles[0].directory = "/tmp";
  expect(sameConfig(config, reordered)).toBe(false);
});

it("detects reverted values and preserves the significance of profile order", () => {
  const config = structuredClone(defaults);
  const draft = structuredClone(config);
  draft.interaction.warnMultilinePaste = !config.interaction.warnMultilinePaste;
  expect(sameConfig(config, draft)).toBe(false);
  draft.interaction.warnMultilinePaste = config.interaction.warnMultilinePaste;
  expect(sameConfig(config, draft)).toBe(true);
  config.profiles = [
    {id: "one", name: "One", distribution: "Debian", username: null, directory: "~"},
    {id: "two", name: "Two", distribution: "Debian", username: null, directory: "/tmp"},
  ];
  draft.profiles = [...config.profiles].reverse();
  expect(sameConfig(config, draft)).toBe(false);
});
