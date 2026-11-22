#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function readRustPackageVersion(manifest) {
  const section = manifest.match(/^\[package\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m);
  const version = section?.[1].match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error("Rust package version is missing");
  return version;
}

export function readLockedPackageVersion(lockfile) {
  const found = [...lockfile.matchAll(/^\[\[package\]\]\s*\r?\nname\s*=\s*"mewsenger"\s*\r?\nversion\s*=\s*"([^"]+)"/gm)];
  if (found.length !== 1) throw new Error("Cargo lockfile app entry is missing or duplicated");
  return found[0][1];
}

export function verifyVersions({ packageVersion, tauriVersion, rustVersion, lockedVersion }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion) ||
      [tauriVersion, rustVersion, lockedVersion].some((value) => value !== packageVersion)) {
    throw new Error("Application versions differ across npm, Tauri, Cargo and Cargo.lock");
  }
  return packageVersion;
}

/** CHANGELOG.md must already describe the version being released. */
export function verifyChangelog(changelog, version) {
  if (!changelog.includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG.md has no section for ${version}; run pnpm changelog`);
  }
}

export function verifyRepository(root = process.cwd()) {
  const read = (name) => readFileSync(resolve(root, name), "utf8");
  const version = verifyVersions({
    packageVersion: JSON.parse(read("package.json")).version,
    tauriVersion: JSON.parse(read("src-tauri/tauri.conf.json")).version,
    rustVersion: readRustPackageVersion(read("src-tauri/Cargo.toml")),
    lockedVersion: readLockedPackageVersion(read("src-tauri/Cargo.lock")),
  });
  verifyChangelog(read("CHANGELOG.md"), version);
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Version manifests verified: ${verifyRepository()}`);
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
