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
  statusListener: undefined as ((event: { payload: { unread_count: number | null } }) => void) | undefined,
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
  runtime.listen.mockReset().mockImplementation((_name, callback) => {
    runtime.statusListener = callback;
    return Promise.resolve(runtime.unlisten);
  });
  runtime.invoke.mockReset().mockImplementation((name) =>
    Promise.resolve(name === "current_status" ? { unread_count: null } : undefined));
  runtime.getVersion.mockReset().mockResolvedValue("2.3.4");
});

test("reads installed app version using the trusted Tauri API", async () => {
  render(<DesktopApp />);
  expect((await screen.findByLabelText("Application version")).textContent).toBe("2.3.4");
  expect(runtime.getVersion).toHaveBeenCalledOnce();
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Status unavailable");
  expect(screen.getByLabelText("Unread conversations").textContent).toBe("–");
});

test("test notification action sends a scoped native request with factual feedback", async () => {
  const user = userEvent.setup();
  render(<DesktopApp />);
  await user.click(screen.getByRole("button", { name: "Test desktop notifications" }));
  expect(runtime.invoke).toHaveBeenCalledWith("test_notification");
  expect(await screen.findByText("Request sent; check Windows notifications")).toBeTruthy();
});

test("test notification errors are shown without claiming delivery", async () => {
  runtime.invoke.mockImplementation((name) =>
    name === "test_notification" ? Promise.reject(new Error("not permitted")) :
      Promise.resolve(name === "current_status" ? { unread_count: null } : undefined),
  );
  const user = userEvent.setup();
  render(<DesktopApp />);
  await user.click(screen.getByRole("button", { name: "Test desktop notifications" }));
  expect(await screen.findByText("Notification request failed")).toBeTruthy();
});

test("does not invent version data outside the Tauri runtime", () => {
  runtime.available = false;
  render(<DesktopApp />);
  expect(screen.getByLabelText("Application version").textContent).toBe("Version unavailable");
  expect(runtime.getVersion).not.toHaveBeenCalled();
  expect(runtime.listen).not.toHaveBeenCalled();
});

test("opens the local native credits window without a clipped footer dialog", async () => {
  const user = userEvent.setup();
  render(<DesktopApp />);
  await user.click(screen.getByRole("button", { name: "Credits" }));
  expect(runtime.invoke).toHaveBeenCalledWith("show_credits");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("opens credits details in the browser preview", async () => {
  runtime.available = false;
  const user = userEvent.setup();
  render(<DesktopApp />);
  await user.click(screen.getByRole("button", { name: "Credits" }));
  expect((await screen.findByRole("dialog")).textContent).toContain("Messenger desktop");
  expect(screen.getByText("Made by Mew")).toBeTruthy();
});

test("native credits window shows factual metadata, not another status bar", async () => {
  runtime.view = "credits";
  render(<DesktopApp />);
  expect(await screen.findByText("Version 2.3.4")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Messenger" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Messenger icon" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  expect(screen.queryByRole("contentinfo", { name: "Application status" })).toBeNull();
  expect(runtime.listen).not.toHaveBeenCalled();
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
  expect(runtime.unlisten).toHaveBeenCalledOnce();
});
