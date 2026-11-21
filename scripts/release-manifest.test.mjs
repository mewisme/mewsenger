import { expect, test } from "vitest";
import { buildManifest } from "./release-manifest.mjs";

const base = { tag: "v1.2.3", setupName: "Mewsenger_1.2.3_x64-setup.exe", signature: " sig\n", notes: "n", now: new Date(0) };

test("manifest points at the tagged setup file with its signature", () => {
  const manifest = buildManifest(base);
  expect(manifest.version).toBe("1.2.3");
  expect(manifest.platforms["windows-x86_64"]).toEqual({
    signature: "sig",
    url: "https://github.com/mewisme/mewsenger/releases/download/v1.2.3/Mewsenger_1.2.3_x64-setup.exe",
  });
});

test("manifest refuses unsigned builds and malformed tags", () => {
  expect(() => buildManifest({ ...base, signature: "  " })).toThrow();
  expect(() => buildManifest({ ...base, tag: "latest" })).toThrow();
});
