// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
  invoke: vi.fn(),
  listen: vi.fn(),
  eventUnlisten: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => runtime.available, invoke: runtime.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: runtime.listen }));
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

async function emit(name: string, payload: unknown) {
  await act(async () => { runtime.handlers.get(name)?.({ payload }); });
}

beforeEach(() => {
  runtime.handlers.clear();
  runtime.invoke.mockReset().mockImplementation((command: string) =>
    Promise.resolve(command === "get_update_state" ? { state: "unconfigured" } : undefined));
  runtime.listen.mockReset().mockImplementation((name: string, handler: (event: { payload: unknown }) => void) => {
    runtime.handlers.set(name, handler);
    return Promise.resolve(runtime.eventUnlisten);
  });
  runtime.eventUnlisten.mockReset();
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
  expect(screen.getByText("Mewsenger")).toBeTruthy();
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
  const area = screen.getByLabelText("Drag Mewsenger window");
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

test("the Settings button is always present and opens settings", async () => {
  const user = userEvent.setup();
  render(<TitleBar />);
  const button = screen.getByRole("button", { name: "Settings" }) as HTMLButtonElement;
  expect(button.title).toBe("Settings");
  expect(button.disabled).toBe(false);
  await user.click(button);
  expect(runtime.invoke).toHaveBeenCalledWith("show_settings");
});

test("the Settings button stays visible without the Tauri runtime", () => {
  runtime.available = false;
  render(<TitleBar />);
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});

test("action buttons sit before the window controls", () => {
  render(<TitleBar />);
  const settings = screen.getByRole("button", { name: "Settings" });
  const controls = screen.getByRole("navigation", { name: "Window controls" });
  expect(settings.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("Updates is hidden until configured, then follows the state and runs check and install", async () => {
  const user = userEvent.setup();
  render(<TitleBar />);
  await waitFor(() => expect(runtime.invoke).toHaveBeenCalledWith("get_update_state"));
  expect(screen.queryByRole("button", { name: "Updates" })).toBeNull();

  await emit("update-status", { state: "idle" });
  const button = () => screen.getByRole("button", { name: "Updates" }) as HTMLButtonElement;
  expect(button().title).toBe("Check for updates");
  await user.click(button());
  expect(runtime.invoke).toHaveBeenCalledWith("check_update");

  await emit("update-status", { state: "available", version: "0.2.0" });
  expect(button().title).toBe("Install version 0.2.0");
  await user.click(button());
  expect(runtime.invoke).toHaveBeenCalledWith("install_update");

  await emit("update-status", { state: "downloading" });
  expect(button().disabled).toBe(true);
  await emit("update-status", { state: "unconfigured" });
  expect(screen.queryByRole("button", { name: "Updates" })).toBeNull();
});

test("Updates is not shown in the browser even if the backend state says otherwise", () => {
  runtime.available = false;
  render(<TitleBar />);
  expect(screen.queryByRole("button", { name: "Updates" })).toBeNull();
  expect(runtime.listen).not.toHaveBeenCalled();
});

test("the download button appears after an event, waits for completion, then reveals the file", async () => {
  const user = userEvent.setup();
  render(<TitleBar />);
  await waitFor(() => expect(runtime.handlers.has("download-status")).toBe(true));
  expect(screen.queryByRole("button", { name: "Download status" })).toBeNull();

  await emit("download-status", { state: "downloading", file_name: "a.pdf" });
  const button = () => screen.getByRole("button", { name: "Download status" }) as HTMLButtonElement;
  expect(button().disabled).toBe(true);
  expect(button().title).toBe("Downloading a.pdf");

  await emit("download-status", { state: "done", file_name: "a.pdf" });
  expect(button().disabled).toBe(false);
  await user.click(button());
  expect(runtime.invoke).toHaveBeenCalledWith("reveal_last_download");

  await emit("download-status", { state: "failed", file_name: "a.pdf" });
  expect(button().disabled).toBe(true);
});

test("the tab strip draws no underline that could overflow the 40px bar", () => {
  render(<TitleBar tabs={{
    accounts: [{ id: "a1", name: "Home" }, { id: "a2", name: "Work" }],
    open: ["a1", "a2"],
    active: "a1",
  }} />);
  for (const tab of screen.getAllByRole("tab")) {
    expect(tab.className.split(/\s+/)).toContain("after:hidden");
  }
  expect(screen.getByRole("banner").className).toContain("overflow-hidden");
  expect(document.documentElement.style.overflow).toBe("hidden");
});

test("page overflow is restored when the title bar unmounts", () => {
  const { unmount } = render(<TitleBar />);
  unmount();
  expect(document.documentElement.style.overflow).toBe("");
});
