import { expect, test } from "vitest";
import { parseAccounts, parseOverlay, parseSplit, parseTabs, resolveLocalView } from "./local-view";

test("routes local assets by their explicit URL rather than potentially shared runtime metadata", () => {
  expect(resolveLocalView("?view=status", "titlebar-a1")).toBe("status");
  expect(resolveLocalView("?view=titlebar", "status-a1")).toBe("titlebar");
  expect(resolveLocalView("?view=settings", "status-a1")).toBe("settings");
  expect(resolveLocalView("?view=split", "status-a1")).toBe("split");
});

test("keeps browser previews and older local URLs usable", () => {
  expect(resolveLocalView("?preview=titlebar", null)).toBe("titlebar");
  expect(resolveLocalView("", "settings")).toBe("settings");
  expect(resolveLocalView("", "split")).toBe("split");
  expect(resolveLocalView("", "titlebar-a2")).toBe("titlebar");
  expect(resolveLocalView("", "status-a1")).toBe("status");
  expect(resolveLocalView("?view=unknown", null)).toBe("status");
  expect(resolveLocalView("?view=credits", null)).toBe("status");
});

test("account lists survive names with separators and drop malformed entries", () => {
  expect(parseAccounts("")).toEqual([{ id: "a1", name: "Account 1" }]);
  expect(parseAccounts("?accounts=a1%3AHome%2Ca2%3AWork%252C%2520home%253A")).toEqual([
    { id: "a1", name: "Home" },
    { id: "a2", name: "Work, home:" },
  ]);
  expect(parseAccounts("?accounts=a1,a2")).toEqual([
    { id: "a1", name: "a1" },
    { id: "a2", name: "a2" },
  ]);
  expect(parseAccounts("?accounts=b1:x,a1234:y,a2:%E0%A4%A,a3:ok,a3:dup")).toEqual([
    { id: "a3", name: "ok" },
  ]);
  expect(parseAccounts("?accounts=nonsense")).toEqual([{ id: "a1", name: "Account 1" }]);
});

test("the split view takes account ids and a bounded ratio", () => {
  expect(parseSplit("?view=split&ratio=0.4&accounts=a1,a2")).toEqual({ ids: ["a1", "a2"], ratio: 0.4 });
  expect(parseSplit("?view=split").ratio).toBe(0.5);
  expect(parseSplit("?ratio=0.99&accounts=a1,a2").ratio).toBe(0.8);
  expect(parseSplit("?ratio=0.01&accounts=a1,a2").ratio).toBe(0.2);
  expect(parseSplit("?ratio=abc").ratio).toBe(0.5);
});

test("tabs need two listed accounts and fall back to the first when the active one is unknown", () => {
  expect(parseTabs("?view=titlebar")).toBeNull();
  expect(parseTabs("?accounts=a1%3AHome")).toBeNull();
  expect(parseTabs("?accounts=a1%3AHome%2Ca2%3AWork&active=a2")).toEqual({
    accounts: [{ id: "a1", name: "Home" }, { id: "a2", name: "Work" }],
    active: "a2",
  });
  expect(parseTabs("?accounts=a1%3AHome%2Ca2%3AWork&active=a9")?.active).toBe("a1");
});

test("the overlay flag is explicit", () => {
  expect(parseOverlay("?view=settings&overlay=1")).toBe(true);
  expect(parseOverlay("?view=settings")).toBe(false);
  expect(parseOverlay("?overlay=yes")).toBe(false);
});
