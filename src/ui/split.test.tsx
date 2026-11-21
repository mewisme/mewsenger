// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PANE_MIN, SplitView } from "./split";

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke, isTauri: () => true }));

let observers: (() => void)[] = [];

beforeEach(() => {
  observers = [];
  mock.invoke.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: (entries: unknown[]) => void) {}
    // The panel library observes its own elements too; only pane elements count.
    observe(element: Element) {
      if (element.hasAttribute("data-pane")) observers.push(() => this.callback([]));
    }
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    queueMicrotask(callback);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // jsdom has no layout: report two panes beside a 6px divider.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const pane = this.getAttribute("data-pane");
    if (pane === "a1") return { x: 0, width: 600 } as DOMRect;
    if (pane === "a2") return { x: 606, width: 600 } as DOMRect;
    return { x: 0, width: 0 } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const flush = () => act(async () => { await Promise.resolve(); });

test("reports both pane rectangles, each at least the minimum width", async () => {
  render(<SplitView ids={["a1", "a2"]} ratio={0.5} />);
  await flush();
  expect(mock.invoke).toHaveBeenCalledWith("set_split_layout", {
    rects: [{ x: 0, width: 600 }, { x: 606, width: 600 }],
  });
  const [, args] = mock.invoke.mock.calls[0] as [string, { rects: { width: number }[] }];
  for (const rect of args.rects) expect(rect.width).toBeGreaterThanOrEqual(PANE_MIN);
});

test("reports again when the layout changes and stops after unmount", async () => {
  const { unmount } = render(<SplitView ids={["a1", "a2"]} ratio={0.5} />);
  await flush();
  const initial = mock.invoke.mock.calls.length;
  observers.forEach((notify) => notify());
  await flush();
  expect(mock.invoke.mock.calls.length).toBeGreaterThan(initial);
  unmount();
  const settled = mock.invoke.mock.calls.length;
  observers.forEach((notify) => notify());
  await flush();
  expect(mock.invoke.mock.calls.length).toBe(settled);
});

test("renders one labelled divider between two panes", () => {
  const { container } = render(<SplitView ids={["a1", "a2"]} ratio={0.3} />);
  expect(container.querySelectorAll("[data-pane]").length).toBe(2);
  expect(container.querySelectorAll("[data-separator], [role='separator']").length).toBe(1);
});
