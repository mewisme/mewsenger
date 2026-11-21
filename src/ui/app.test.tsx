// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesktopApp } from "./app";

const runtime = vi.hoisted(() => ({
  available: true,
  getVersion: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  statusListener: undefined as ((event: { payload: { unread_count: number | null; session?: boolean | null } }) => void) | undefined,
  unlisten: vi.fn(),
  view: "status",
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
afterEach(cleanup);
beforeEach(() => {
  runtime.available = true;
  runtime.view = "status";
  runtime.statusListener = undefined;
  runtime.unlisten.mockReset();
  runtime.listen.mockReset().mockImplementation((name, callback) => {
    if (name === "desktop-status") runtime.statusListener = callback;
    return Promise.resolve(runtime.unlisten);
  });
  runtime.invoke.mockReset().mockImplementation((name) =>
    Promise.resolve(name === "current_status" ? { unread_count: null } : undefined));
  runtime.getVersion.mockReset().mockResolvedValue("2.3.4");
});

test("status bar shows connection and unread only; version lives in Settings", async () => {
  render(<DesktopApp />);
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Status unavailable");
  expect(screen.getByLabelText("Unread conversations").textContent).toBe("–");
  expect(screen.queryByLabelText("Application version")).toBeNull();
  expect(screen.queryByRole("button", { name: "Credits" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Test desktop notifications" })).toBeNull();
  expect(runtime.getVersion).not.toHaveBeenCalled();
});

test("the update control stays hidden while updates are not configured", async () => {
  render(<DesktopApp />);
  await waitFor(() => expect(runtime.invoke).toHaveBeenCalledWith("get_update_state"));
  expect(screen.queryByRole("button", { name: "Updates" })).toBeNull();
});

test("the gear opens the native settings window", async () => {
  const user = userEvent.setup();
  render(<DesktopApp />);
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(runtime.invoke).toHaveBeenCalledWith("show_settings");
});

test("the settings window reads the installed version and does not subscribe to footer events", async () => {
  runtime.view = "settings";
  render(<DesktopApp />);
  expect(await screen.findByText(/Version 2\.3\.4/)).toBeTruthy();
  expect(screen.queryByRole("contentinfo", { name: "Application status" })).toBeNull();
  expect(runtime.listen).not.toHaveBeenCalledWith("desktop-status", expect.any(Function));
});

test("does not invent data outside the Tauri runtime", () => {
  runtime.available = false;
  render(<DesktopApp />);
  expect(runtime.getVersion).not.toHaveBeenCalled();
  expect(runtime.listen).not.toHaveBeenCalled();
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Status unavailable");
});

test("local title bar never renders the bottom status bar or requests native unread data", () => {
  runtime.view = "titlebar";
  render(<DesktopApp />);
  expect(screen.getByRole("banner", { name: "Window title bar" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Window controls" })).toBeTruthy();
  expect(screen.queryByRole("contentinfo", { name: "Application status" })).toBeNull();
  expect(runtime.invoke).not.toHaveBeenCalled();
  expect(runtime.listen).not.toHaveBeenCalled();
  expect(runtime.getVersion).not.toHaveBeenCalled();
});

test("displays only confirmed unread count and clears it on reset", async () => {
  runtime.invoke.mockImplementation((name) => Promise.resolve(
    name === "current_status" ? { unread_count: 3 } : undefined,
  ));
  render(<DesktopApp />);
  expect((await screen.findByLabelText("Unread conversations")).textContent).toBe("3");
  expect(runtime.listen).toHaveBeenCalledWith("desktop-status", expect.any(Function));
  const { act } = await import("@testing-library/react");
  await act(async () => runtime.statusListener?.({ payload: { unread_count: 5 } }));
  expect(screen.getByLabelText("Unread conversations").textContent).toBe("5");
  await act(async () => runtime.statusListener?.({ payload: { unread_count: null } }));
  expect(screen.getByLabelText("Unread conversations").textContent).toBe("–");
});

test("rejects invalid native unread values", async () => {
  render(<DesktopApp />);
  const { act } = await import("@testing-library/react");
  await act(async () => runtime.statusListener?.({ payload: { unread_count: -1 } }));
  expect(screen.getByLabelText("Unread conversations").textContent).toBe("–");
});

test("reports offline without treating online network as Messenger connectivity", async () => {
  const { act } = await import("@testing-library/react");
  render(<DesktopApp />);
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Status unavailable");
  await act(async () => window.dispatchEvent(new Event("offline")));
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Offline");
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Status unavailable");
});

test("removes the native status event listener when the view unmounts", async () => {
  const { unmount } = render(<DesktopApp />);
  await waitFor(() => expect(runtime.invoke).toHaveBeenCalledWith("current_status"));
  unmount();
  // status, download and update subscriptions
  expect(runtime.unlisten).toHaveBeenCalledTimes(3);
});

test("connection label follows the verified session, with offline taking priority", async () => {
  render(<DesktopApp />);
  const { act } = await import("@testing-library/react");
  const label = () => screen.getByRole("status", { name: "Connection status" }).textContent;
  await waitFor(() => expect(runtime.statusListener).toBeTruthy());
  await act(async () => runtime.statusListener?.({ payload: { unread_count: 0, session: true } }));
  expect(label()).toBe("Connected");
  await act(async () => runtime.statusListener?.({ payload: { unread_count: 0, session: false } }));
  expect(label()).toBe("Signed out");
  await act(async () => window.dispatchEvent(new Event("offline")));
  expect(label()).toBe("Offline");
  await act(async () => runtime.statusListener?.({ payload: { unread_count: null, session: null } }));
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(label()).toBe("Status unavailable");
});
