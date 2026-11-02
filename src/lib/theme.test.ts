// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { syncSystemTheme } from "./theme";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

test("uses the system color scheme and responds to changes", () => {
  let listener: ((event: MediaQueryListEvent) => void) | null = null;
  const media = {
    matches: true,
    addEventListener: vi.fn((_type, callback) => { listener = callback; }),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList;

  const stop = syncSystemTheme(document.documentElement, media);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe("dark");

  Object.defineProperty(media, "matches", { value: false, configurable: true });
  if (!listener) throw new Error("Missing theme listener");
  (listener as (event: MediaQueryListEvent) => void)({} as MediaQueryListEvent);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(document.documentElement.style.colorScheme).toBe("light");

  stop();
  expect(media.removeEventListener).toHaveBeenCalledOnce();
});
