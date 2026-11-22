// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesktopApp } from "./app";

const runtime = vi.hoisted(() => ({
  available: true,
  getVersion: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  view: "titlebar-a1",
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => runtime.available,
  invoke: runtime.invoke,
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: runtime.getVersion }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ label: runtime.view }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: runtime.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    minimize: () => Promise.resolve(),
    maximize: () => Promise.resolve(),
    unmaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
    startDragging: () => Promise.resolve(),
  }),
}));

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});
beforeEach(() => {
  runtime.available = true;
  runtime.view = "titlebar-a1";
  runtime.unlisten.mockReset();
  runtime.listen.mockReset().mockImplementation(() => Promise.resolve(runtime.unlisten));
  runtime.invoke.mockReset().mockResolvedValue(undefined);
  runtime.getVersion.mockReset().mockResolvedValue("2.3.4");
});

test("an unknown webview label falls back to the title bar; version lives in Settings", () => {
  runtime.view = "whatever";
  render(<DesktopApp />);
  expect(screen.getByRole("banner", { name: "Window title bar" })).toBeTruthy();
  expect(screen.queryByRole("contentinfo")).toBeNull();
  expect(screen.queryByLabelText("Application version")).toBeNull();
  expect(runtime.getVersion).not.toHaveBeenCalled();
});

test("settings read the installed version and have no close button of their own", async () => {
  runtime.view = "settings";
  const user = userEvent.setup();
  render(<DesktopApp />);
  await user.click(await screen.findByRole("tab", { name: "About" }));
  expect(await screen.findByText(/Version 2\.3\.4/)).toBeTruthy();
  expect(screen.queryByRole("banner")).toBeNull();
  expect(screen.queryByRole("button", { name: "Close settings" })).toBeNull();
});

test("does not invent data outside the Tauri runtime", () => {
  runtime.available = false;
  render(<DesktopApp />);
  expect(runtime.getVersion).not.toHaveBeenCalled();
  expect(runtime.invoke).not.toHaveBeenCalled();
  expect(runtime.listen).not.toHaveBeenCalledWith("download-status", expect.anything());
  expect(runtime.listen).not.toHaveBeenCalledWith("update-status", expect.anything());
});

test("title bar without parameters still renders one tab and the window controls", () => {
  runtime.view = "titlebar-a1";
  render(<DesktopApp />);
  expect(screen.getByRole("banner", { name: "Window title bar" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Window controls" })).toBeTruthy();
  expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual(["Anonymous"]);
  expect(screen.queryByRole("button", { name: /^Close tab/ })).toBeNull();
  expect(runtime.invoke).not.toHaveBeenCalledWith("open_account", expect.anything());
});

const TABS_URL = "/?view=titlebar&accounts=a1%3AHome%2Ca2%3AWork%2Ca3%3ASpare&open=a1,a2&active=a2";

function openTitleBar(url = TABS_URL) {
  runtime.view = "titlebar-a1";
  window.history.pushState({}, "", url);
  let announce: ((event: { payload: unknown }) => void) | undefined;
  runtime.listen.mockImplementation((name: string, callback: never) => {
    if (name === "accounts-changed") announce = callback;
    return Promise.resolve(runtime.unlisten);
  });
  render(<DesktopApp />);
  runtime.invoke.mockClear();
  return { announce: (payload: unknown) => act(async () => announce?.({ payload })) };
}

test("the title bar shows one tab per open account and switches on click", async () => {
  const user = userEvent.setup();
  openTitleBar();
  expect(screen.getByRole("tablist")).toBeTruthy();
  expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual(["Home", "Work"]);
  expect(screen.getByRole("tab", { name: "Work" }).getAttribute("aria-selected")).toBe("true");
  await user.click(screen.getByRole("tab", { name: "Home" }));
  expect(runtime.invoke).toHaveBeenCalledWith("open_account", { id: "a1" });
  expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
});

test("closing a tab goes through close_tab without switching to it; one tab has no close button", async () => {
  const user = userEvent.setup();
  const { announce } = openTitleBar();
  await user.click(screen.getByRole("button", { name: "Close tab Home" }));
  expect(runtime.invoke).toHaveBeenCalledWith("close_tab", { id: "a1" });
  expect(runtime.invoke).not.toHaveBeenCalledWith("open_account", expect.anything());
  fireEvent(screen.getByRole("tab", { name: "Work" }), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
  expect(runtime.invoke).toHaveBeenCalledWith("close_tab", { id: "a2" });
  runtime.invoke.mockClear();
  await announce({
    accounts: [{ id: "a1", display_name: "Home" }, { id: "a2", display_name: "Work" }],
    open: ["a2"],
    active: "a2",
  });
  expect(screen.queryByRole("button", { name: /^Close tab/ })).toBeNull();
  fireEvent(screen.getByRole("tab", { name: "Work" }), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
  expect(runtime.invoke).not.toHaveBeenCalled();
});

test("the plus button asks the backend for the menu at its own left edge", async () => {
  const user = userEvent.setup();
  openTitleBar();
  const plus = screen.getByRole("button", { name: "New tab" });
  expect(plus.getAttribute("aria-haspopup")).toBe("menu");
  vi.spyOn(plus, "getBoundingClientRect").mockReturnValue({
    left: 212, right: 236, top: 0, bottom: 24, width: 24, height: 24, x: 212, y: 0, toJSON: () => ({}),
  });
  await user.click(plus);
  expect(runtime.invoke).toHaveBeenCalledWith("open_tab_menu", { x: 212 });
});

test("tabs follow account changes announced by the backend and ignore malformed payloads", async () => {
  const { announce } = openTitleBar();
  await waitFor(() => expect(runtime.listen).toHaveBeenCalledWith("accounts-changed", expect.any(Function)));
  await announce({ accounts: "nope" });
  await announce(null);
  expect(screen.getAllByRole("tab").length).toBe(2);
  await announce({
    accounts: [{ id: "a1", display_name: "Home" }, { id: "a2", display_name: "Phone" }, { id: "a3", display_name: "Spare" }],
    open: ["a1", "a2", "a3"],
    active: "a3",
  });
  expect(screen.getAllByRole("tab").length).toBe(3);
  expect(screen.getByRole("tab", { name: "Spare" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Phone" })).toBeTruthy();
  expect(screen.queryByRole("tab", { name: "Work" })).toBeNull();
});

test("the tab menu view renders the dropdown only", () => {
  runtime.view = "tabmenu";
  window.history.pushState({}, "", "/?view=tabmenu&accounts=a2%3AWork&next=3");
  render(<DesktopApp />);
  expect(screen.getByRole("menu")).toBeTruthy();
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["WWork", "Sign in to a new account"]);
  expect(screen.queryByRole("banner")).toBeNull();
});

test("removes every title bar subscription when it unmounts", async () => {
  const { unmount } = render(<DesktopApp />);
  await waitFor(() => expect(runtime.invoke).toHaveBeenCalledWith("get_update_state"));
  unmount();
  expect(runtime.unlisten).toHaveBeenCalledTimes(6);
});
