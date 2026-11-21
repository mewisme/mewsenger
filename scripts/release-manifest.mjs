#!/usr/bin/env node
// Builds the updater manifest (latest.json) for a Windows release.
// Usage: node scripts/release-manifest.mjs <tag> <setup.exe> <setup.exe.sig> [out]
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

export function buildManifest({ tag, setupName, signature, notes, now }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`unexpected tag: ${tag}`);
  if (!signature.trim()) throw new Error("empty signature");
  return {
    version: tag.slice(1),
    notes,
    pub_date: now.toISOString(),
    platforms: {
      "windows-x86_64": {
        signature: signature.trim(),
        url: `https://github.com/mewisme/mewsenger/releases/download/${tag}/${encodeURIComponent(setupName)}`,
      },
    },
  };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [tag, setup, sig, out = "latest.json"] = process.argv.slice(2);
  if (!tag || !setup || !sig) {
    console.error("usage: release-manifest.mjs <tag> <setup.exe> <setup.exe.sig> [out]");
    process.exit(2);
  }
  const manifest = buildManifest({
    tag,
    setupName: basename(setup),
    signature: readFileSync(sig, "utf8"),
    notes: `Mewsenger ${tag}`,
    now: new Date(),
  });
  writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
}
