// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TitleBar } from "./title-bar";

const runtime = vi.hoisted(() => ({
  available: true,
  minimized: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  close: vi.fn(),
  drag: vi.fn(),
  isMaximized: vi.fn(),
  onResized: vi.fn(),
  unlisten: vi.fn(),
  resizeHandler: undefined as (() => void) | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => runtime.available }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: runtime.minimized,
    maximize: runtime.maximize,
    unmaximize: runtime.unmaximize,
    close: runtime.close,
    startDragging: runtime.drag,
    isMaximized: runtime.isMaximized,
    onResized: runtime.onResized,
  }),
}));

beforeEach(() => {
  runtime.available = true;
  runtime.resizeHandler = undefined;
  for (const fn of [runtime.minimized, runtime.maximize, runtime.unmaximize, runtime.close, runtime.drag,
    runtime.isMaximized, runtime.onResized, runtime.unlisten]) {
    fn.mockReset();
  }
  runtime.isMaximized.mockResolvedValue(false);
  runtime.minimized.mockResolvedValue(undefined);
  runtime.maximize.mockImplementation(() => {
    runtime.isMaximized.mockResolvedValue(true);
    return Promise.resolve();
  });
  runtime.unmaximize.mockImplementation(() => {
    runtime.isMaximized.mockResolvedValue(false);
    return Promise.resolve();
  });
  runtime.close.mockResolvedValue(undefined);
  runtime.drag.mockResolvedValue(undefined);
  runtime.onResized.mockImplementation((callback) => {
    runtime.resizeHandler = callback;
    return Promise.resolve(runtime.unlisten);
  });
});

afterEach(cleanup);

test("renders separate top window controls with accessible names", async () => {
  render(<TitleBar />);
  expect(screen.getByRole("banner", { name: "Window title bar" })).toBeTruthy();
  expect(screen.getByText("Messenger")).toBeTruthy();
  expect(screen.getByRole("banner", { name: "Window title bar" })
    .querySelector("img")?.getAttribute("src")).toContain("32x32");
  expect(screen.getByRole("navigation", { name: "Window controls" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Minimize window" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Maximize window" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Close window" })).toBeTruthy();
  await waitFor(() => expect(runtime.onResized).toHaveBeenCalledOnce());
});

test("minimize, restore and close call only native window actions", async () => {
  const user = userEvent.setup();
  render(<TitleBar />);
  await user.click(screen.getByRole("button", { name: "Minimize window" }));
  expect(runtime.minimized).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Maximize window" }));
  expect(runtime.maximize).toHaveBeenCalledOnce();
  expect(await screen.findByRole("button", { name: "Restore window" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Restore window" }));
  expect(runtime.unmaximize).toHaveBeenCalledOnce();
  expect(await screen.findByRole("button", { name: "Maximize window" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Close window" }));
  expect(runtime.close).toHaveBeenCalledOnce();
});

test("left mouse drag and double-click maximize work only in title area", async () => {
  const user = userEvent.setup();
  render(<TitleBar />);
  const area = screen.getByLabelText("Drag Messenger window");
  await user.pointer({ keys: "[MouseLeft>]", target: area });
  expect(runtime.drag).toHaveBeenCalledOnce();
  await user.pointer({ keys: "[/MouseLeft]", target: area });
  await user.dblClick(area);
  expect(runtime.maximize).toHaveBeenCalled();
});

test("browser-only preview disables all native window actions", () => {
  runtime.available = false;
  render(<TitleBar />);
  for (const name of ["Minimize window", "Maximize window", "Close window"]) {
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  }
  expect(runtime.onResized).not.toHaveBeenCalled();
});

test("removes window resize listener when titlebar unmounts", async () => {
  const { unmount } = render(<TitleBar />);
  await waitFor(() => expect(runtime.onResized).toHaveBeenCalledOnce());
  unmount();
  expect(runtime.unlisten).toHaveBeenCalledOnce();
});
