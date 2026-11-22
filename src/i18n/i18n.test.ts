import { expect, test } from "vitest";
import { en } from "./en";
import { vi } from "./vi";
import { resolveLanguage, translate } from "./index";

test("the system language picks Vietnamese for any vi locale and English otherwise", () => {
  expect(resolveLanguage("system", "vi-VN")).toBe("vi");
  expect(resolveLanguage("system", "vi")).toBe("vi");
  expect(resolveLanguage("system", "en-US")).toBe("en");
  expect(resolveLanguage("system", "fr")).toBe("en");
  expect(resolveLanguage("system", undefined)).toBe("en");
  expect(resolveLanguage(null, "vi-VN")).toBe("vi");
});

test("an explicit language beats the system language", () => {
  expect(resolveLanguage("en", "vi-VN")).toBe("en");
  expect(resolveLanguage("vi", "en-US")).toBe("vi");
  expect(resolveLanguage("klingon", "fr")).toBe("en");
});

test("every English key exists in Vietnamese and nothing extra does", () => {
  expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
  for (const [key, text] of Object.entries(vi)) expect(text.trim(), key).not.toBe("");
});

test("placeholders match between languages", () => {
  const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(names(vi[key]), key).toEqual(names(en[key]));
  }
});

test("values are interpolated and unknown placeholders stay visible", () => {
  expect(translate("en", "tabs.closeTab", { name: "Work" })).toBe("Close tab Work");
  expect(translate("vi", "tabs.closeTab", { name: "Work" })).toBe("Đóng thẻ Work");
  expect(translate("en", "tabs.closeTab", {})).toBe("Close tab {name}");
});
