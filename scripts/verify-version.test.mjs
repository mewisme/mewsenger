import { expect, test } from "vitest";
import {
  readRustPackageVersion,
  readLockedPackageVersion,
  setRustPackageVersion,
  verifyVersions,
  verifyRepository,
} from "./verify-version.mjs";

test("installed application metadata is consistent", () => {
  expect(verifyRepository()).toMatch(/^\d+\.\d+\.\d+$/);
});

test("Rust manifest replacement only changes the application package version", () => {
  const source = '[package]\nname = "mewsenger"\nversion = "0.1.1"\n\n[dependencies]\ntauri = { version = "2.12.5" }\n';
  const updated = setRustPackageVersion(source, "0.1.14");
  expect(readRustPackageVersion(updated)).toBe("0.1.14");
  expect(updated).toContain('tauri = { version = "2.12.5" }');
  expect(readRustPackageVersion(source)).toBe("0.1.1");
});

test("Cargo lockfile parser reads only the app entry", () => {
  const text = '[[package]]\nname = "tauri"\nversion = "2.12.5"\n\n[[package]]\nname = "mewsenger"\nversion = "0.1.14"\n';
  expect(readLockedPackageVersion(text)).toBe("0.1.14");
  expect(() => readLockedPackageVersion(text + '\n[[package]]\nname = "mewsenger"\nversion = "1.0.0"\n')).toThrow();
});

test("version verification rejects malformed or divergent metadata", () => {
  const consistent = {
    packageVersion: "0.1.14",
    tauriVersion: "0.1.14",
    rustVersion: "0.1.14",
    lockedVersion: "0.1.14",
  };
  expect(verifyVersions(consistent)).toBe("0.1.14");
  expect(() => verifyVersions({ ...consistent, rustVersion: "0.1.1" })).toThrow();
  expect(() => verifyVersions({ ...consistent, lockedVersion: "0.1.1" })).toThrow();
  expect(() => verifyVersions({ ...consistent, packageVersion: "latest" })).toThrow();
});
