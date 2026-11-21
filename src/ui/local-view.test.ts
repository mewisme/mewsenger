import { expect, test } from "vitest";
import { parseAccounts, parseOverlay, parseTabMenu, parseTabs, resolveLocalView } from "./local-view";

test("routes local assets by their explicit URL rather than potentially shared runtime metadata", () => {
  expect(resolveLocalView("?view=titlebar", "settings")).toBe("titlebar");
  expect(resolveLocalView("?view=settings", "titlebar-a1")).toBe("settings");
  expect(resolveLocalView("?view=tabmenu", "titlebar-a1")).toBe("tabmenu");
});

test("keeps browser previews and older local URLs usable", () => {
  expect(resolveLocalView("?preview=titlebar", null)).toBe("titlebar");
  expect(resolveLocalView("", "settings")).toBe("settings");
  expect(resolveLocalView("", "tabmenu")).toBe("tabmenu");
  expect(resolveLocalView("", "titlebar-a2")).toBe("titlebar");
  expect(resolveLocalView("", "unknown")).toBe("titlebar");
  expect(resolveLocalView("?view=unknown", null)).toBe("titlebar");
  expect(resolveLocalView("?view=status", null)).toBe("titlebar");
});

test("account lists survive names with separators and drop malformed entries", () => {
  expect(parseAccounts("")).toEqual([{ id: "a1", name: "" }]);
  expect(parseAccounts("?accounts=a1%3AHome%2Ca2%3AWork%252C%2520home%253A")).toEqual([
    { id: "a1", name: "Home" },
    { id: "a2", name: "Work, home:" },
  ]);
  expect(parseAccounts("?accounts=a1,a2")).toEqual([
    { id: "a1", name: "" },
    { id: "a2", name: "" },
  ]);
  expect(parseAccounts("?accounts=a1%3A%2Ca2%3AWork")).toEqual([
    { id: "a1", name: "" },
    { id: "a2", name: "Work" },
  ]);
  expect(parseAccounts("?accounts=b1:x,a1234:y,a2:%E0%A4%A,a3:ok,a3:dup")).toEqual([
    { id: "a3", name: "ok" },
  ]);
  expect(parseAccounts("?accounts=nonsense")).toEqual([{ id: "a1", name: "" }]);
});

test("tabs list every account, keep known open ids in order and fall back to the first open one", () => {
  expect(parseTabs("?view=titlebar")).toEqual({
    accounts: [{ id: "a1", name: "" }],
    open: ["a1"],
    active: "a1",
  });
  expect(parseTabs("?accounts=a1%3AHome%2Ca2%3AWork%2Ca3%3ASpare&open=a2,a1&active=a2")).toEqual({
    accounts: [{ id: "a1", name: "Home" }, { id: "a2", name: "Work" }, { id: "a3", name: "Spare" }],
    open: ["a2", "a1"],
    active: "a2",
  });
  expect(parseTabs("?accounts=a1,a2&open=a9,a2,a2&active=a1")).toMatchObject({ open: ["a2"], active: "a2" });
  expect(parseTabs("?accounts=a1,a2&open=a2&active=a9").active).toBe("a2");
  expect(parseTabs("?accounts=a1:Home,a2:Work")).toMatchObject({ open: ["a1"], active: "a1" });
});

test("the tab menu may list no accounts and defaults the next number", () => {
  expect(parseTabMenu("?view=tabmenu")).toEqual({ accounts: [], next: 2 });
  expect(parseTabMenu("?view=tabmenu&accounts=&next=5")).toEqual({ accounts: [], next: 5 });
  expect(parseTabMenu("?accounts=nonsense&next=x").accounts).toEqual([]);
  expect(parseTabMenu("?accounts=a2%3AWork%2Ca3%3AHome&next=4")).toEqual({
    accounts: [{ id: "a2", name: "Work" }, { id: "a3", name: "Home" }],
    next: 4,
  });
});

test("the overlay flag is explicit", () => {
  expect(parseOverlay("?view=settings&overlay=1")).toBe(true);
  expect(parseOverlay("?view=settings")).toBe(false);
  expect(parseOverlay("?overlay=yes")).toBe(false);
});
