// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountTabs } from "./account-tabs";

const runtime = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: runtime.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: runtime.listen }));

const VIEW = {
  accounts: [{ id: "a1", name: "Home" }, { id: "a2", name: "Work" }, { id: "a3", name: "Spare" }],
  open: ["a1", "a2", "a3"],
  active: "a1",
};

// Each tab is 100px wide, no gap: a1 0-100, a2 100-200, a3 200-300.
const LEFTS: Record<string, number> = { a1: 0, a2: 100, a3: 200 };

beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", PointerEventPolyfill);
  }
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.setPointerCapture = () => {};
  proto.hasPointerCapture = () => true;
  proto.releasePointerCapture = () => {};
});

beforeEach(() => {
  runtime.unlisten.mockReset();
  runtime.listen.mockReset().mockImplementation(() => Promise.resolve(runtime.unlisten));
  runtime.invoke.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

function layoutTabs() {
  for (const [id, left] of Object.entries(LEFTS)) {
    const tab = screen.getByRole("tab", { name: VIEW.accounts.find((a) => a.id === id)?.name });
    const holder = tab.parentElement as HTMLElement;
    vi.spyOn(holder, "getBoundingClientRect").mockReturnValue({
      left, right: left + 100, top: 0, bottom: 32, width: 100, height: 32, x: left, y: 0, toJSON: () => ({}),
    });
  }
}

function pointer(target: Element, type: string, clientX: number) {
  fireEvent(target, new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, pointerId: 1 }));
}

function setup() {
  render(<AccountTabs initial={VIEW} />);
  layoutTabs();
  return screen.getByRole("tab", { name: "Home" });
}

function order() {
  return screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"));
}

test("dragging a tab past its neighbours commits move_tab and never opens the tab", () => {
  const home = setup();
  pointer(home, "pointerdown", 50);
  pointer(home, "pointermove", 120);
  pointer(home, "pointermove", 260);
  pointer(home, "pointerup", 260);
  expect(runtime.invoke).toHaveBeenCalledTimes(1);
  expect(runtime.invoke).toHaveBeenCalledWith("move_tab", { id: "a1", index: 2 });
  expect(order()).toEqual(["Work", "Spare", "Home"]);
  fireEvent.click(home);
  expect(runtime.invoke).not.toHaveBeenCalledWith("open_account", expect.anything());
});

test("a drag that ends where it started commits nothing", () => {
  const home = setup();
  pointer(home, "pointerdown", 50);
  pointer(home, "pointermove", 70);
  pointer(home, "pointerup", 50);
  expect(runtime.invoke).not.toHaveBeenCalled();
  expect(order()).toEqual(["Home", "Work", "Spare"]);
});

test("movement under the threshold is a plain click", () => {
  setup();
  const work = screen.getByRole("tab", { name: "Work" });
  pointer(work, "pointerdown", 150);
  pointer(work, "pointermove", 152);
  pointer(work, "pointerup", 152);
  fireEvent.click(work);
  expect(runtime.invoke).toHaveBeenCalledTimes(1);
  expect(runtime.invoke).toHaveBeenCalledWith("open_account", { id: "a2" });
});

test("escape during a drag restores the order and commits nothing", () => {
  const home = setup();
  pointer(home, "pointerdown", 50);
  pointer(home, "pointermove", 260);
  fireEvent.keyDown(document, { key: "Escape" });
  pointer(home, "pointerup", 260);
  expect(runtime.invoke).not.toHaveBeenCalled();
  expect(order()).toEqual(["Home", "Work", "Spare"]);
});

test("a drag is clamped to the strip: dragging far left keeps index 0", () => {
  setup();
  const spare = screen.getByRole("tab", { name: "Spare" });
  pointer(spare, "pointerdown", 250);
  pointer(spare, "pointermove", -500);
  pointer(spare, "pointerup", -500);
  expect(runtime.invoke).toHaveBeenCalledWith("move_tab", { id: "a3", index: 0 });
});

test("keyboard shortcuts forward the matching tab action", () => {
  setup();
  const cases: [KeyboardEventInit, string][] = [
    [{ key: "t", ctrlKey: true }, "new"],
    [{ key: "w", ctrlKey: true }, "close"],
    [{ key: "Tab", ctrlKey: true }, "next"],
    [{ key: "Tab", ctrlKey: true, shiftKey: true }, "prev"],
  ];
  for (const [init, action] of cases) {
    runtime.invoke.mockClear();
    const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(runtime.invoke).toHaveBeenCalledWith("tab_shortcut", { action });
  }
  runtime.invoke.mockClear();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", ctrlKey: true, repeat: true, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true, repeat: true, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
  expect(runtime.invoke).not.toHaveBeenCalled();
});

test("the tab-shortcut event opens the dropdown like the plus button", async () => {
  let announce: ((event: { payload: unknown }) => void) | undefined;
  runtime.listen.mockImplementation((name: string, callback: never) => {
    if (name === "tab-shortcut") announce = callback;
    return Promise.resolve(runtime.unlisten);
  });
  render(<AccountTabs initial={VIEW} />);
  const plus = screen.getByRole("button", { name: "New tab" });
  vi.spyOn(plus, "getBoundingClientRect").mockReturnValue({
    left: 312, right: 336, top: 0, bottom: 24, width: 24, height: 24, x: 312, y: 0, toJSON: () => ({}),
  });
  await act(async () => announce?.({ payload: { action: "new" } }));
  expect(runtime.invoke).toHaveBeenCalledWith("open_tab_menu", { x: 312 });
  runtime.invoke.mockClear();
  await act(async () => announce?.({ payload: { action: "other" } }));
  expect(runtime.invoke).not.toHaveBeenCalled();
});
