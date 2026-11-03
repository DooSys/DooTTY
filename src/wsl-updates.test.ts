import { expect, it } from "vitest";
import { compareVersions } from "./wsl-updates";

it("compares WSL's four-part version with GitHub stable tags", () => {
  expect(compareVersions("3.0.3.0", "v3.0.3")).toBe(0);
  expect(compareVersions("3.0.3.1", "3.0.3")).toBe(1);
  expect(compareVersions("2.6.1.0", "3.0.3")).toBe(-1);
});
it("compares numeric components and does not offer downgrades", () => {
  expect(compareVersions("3.0.9.0", "3.0.10")).toBe(-1);
  expect(compareVersions("3.1.0.0", "3.0.10")).toBe(1);
});
it("refuses unknown and prerelease versions instead of guessing", () => {
  for (const version of ["", "3.0", "3.0.3-rc.1", "999999999999.0.0", "Kernel 6.6.87"]) {
    expect(compareVersions(version, "3.0.3")).toBeNull();
  }
});
