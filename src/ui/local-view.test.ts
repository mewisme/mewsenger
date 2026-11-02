import { expect, test } from "vitest";
import { resolveLocalView } from "./local-view";

test("routes local assets by their explicit URL rather than potentially shared runtime metadata", () => {
  expect(resolveLocalView("?view=status", "titlebar")).toBe("status");
  expect(resolveLocalView("?view=titlebar", "status")).toBe("titlebar");
  expect(resolveLocalView("?view=credits", "status")).toBe("credits");
});

test("keeps browser previews and older local URLs usable", () => {
  expect(resolveLocalView("?preview=titlebar", null)).toBe("titlebar");
  expect(resolveLocalView("", "credits")).toBe("credits");
  expect(resolveLocalView("", "status")).toBe("status");
  expect(resolveLocalView("?view=unknown", null)).toBe("status");
});
