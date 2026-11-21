// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./settings";
import type { AccountsConfig, LayoutMode } from "./accounts-section";

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  isEnabled: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  handler: undefined as ((event: { payload: { notification_preview: boolean } }) => void) | undefined,
  accounts: undefined as ((event: { payload: unknown }) => void) | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mock.listen }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: mock.isEnabled,
  enable: mock.enable,
  disable: mock.disable,
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
  mock.handler = undefined;
  mock.accounts = undefined;
  mock.invoke.mockReset().mockImplementation((command: string) =>
    command === "get_preferences"
      ? Promise.resolve({ notification_preview: true })
      : Promise.reject(new Error(`unexpected ${command}`)));
  mock.listen.mockReset().mockImplementation((name: string, handler: never) => {
    if (name === "prefs-changed") mock.handler = handler;
    if (name === "accounts-changed") mock.accounts = handler;
    return Promise.resolve(() => {});
  });
  mock.isEnabled.mockReset().mockResolvedValue(false);
  mock.enable.mockReset().mockResolvedValue(undefined);
  mock.disable.mockReset().mockResolvedValue(undefined);
});

const preview = () => screen.getByRole("switch", { name: "Show message previews in notifications" });

test("shows the stored preference and names every control", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "get_preferences"
      ? Promise.resolve({ notification_preview: false })
      : Promise.reject(new Error("x")));
  render(<Settings version="0.1.14" />);
  await waitFor(() => expect(preview().getAttribute("aria-checked")).toBe("false"));
  expect(screen.getByRole("switch", { name: "Launch Messenger when I sign in to Windows" })).toBeTruthy();
  expect(screen.getByText(/Version 0\.1\.14/)).toBeTruthy();
});

test("toggling saves the exact key and value", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "get_preferences"
      ? Promise.resolve({ notification_preview: true })
      : Promise.resolve({ notification_preview: false }));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await waitFor(() => expect((preview() as HTMLButtonElement).disabled).toBe(false));
  await user.click(preview());
  expect(mock.invoke).toHaveBeenCalledWith("set_preference", {
    key: "notification_preview",
    value: false,
  });
  await waitFor(() => expect(preview().getAttribute("aria-checked")).toBe("false"));
});

test("a change made from the tray updates the switch", async () => {
  render(<Settings version="0.1.14" />);
  await waitFor(() => expect(mock.handler).toBeTruthy());
  await waitFor(() => expect(preview().getAttribute("aria-checked")).toBe("true"));
  act(() => mock.handler!({ payload: { notification_preview: false } }));
  await waitFor(() => expect(preview().getAttribute("aria-checked")).toBe("false"));
});

test("a failed save reverts the switch and says so", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "get_preferences"
      ? Promise.resolve({ notification_preview: true })
      : Promise.reject(new Error("disk")));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await waitFor(() => expect((preview() as HTMLButtonElement).disabled).toBe(false));
  await user.click(preview());
  expect((await screen.findByRole("alert")).textContent).toBe("Could not save");
  expect(preview().getAttribute("aria-checked")).toBe("true");
});

test("autostart is read from the system and toggled through the plugin", async () => {
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  const toggle = screen.getByRole("switch", { name: "Launch Messenger when I sign in to Windows" });
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
  await user.click(toggle);
  expect(mock.enable).toHaveBeenCalledOnce();
  await user.click(toggle);
  expect(mock.disable).toHaveBeenCalledOnce();
});

test("copy diagnostics writes exactly what the backend returned", async () => {
  const diagnostics = { app_version: "0.1.14", os: "windows", session: true, unread_known: false };
  mock.invoke.mockImplementation((command: string) =>
    command === "get_diagnostics"
      ? Promise.resolve(diagnostics)
      : command === "get_preferences"
        ? Promise.resolve({ notification_preview: true })
        : Promise.reject(new Error("x")));
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  render(<Settings version="0.1.14" />);
  await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(diagnostics, null, 2)));
});

test("update section follows the update state and installs when one is available", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "get_update_state"
      ? Promise.resolve({ state: "available", version: "0.2.0" })
      : command === "get_preferences"
        ? Promise.resolve({ notification_preview: true })
        : command === "install_update"
          ? Promise.resolve({ state: "downloading" })
          : Promise.reject(new Error("x")));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  expect(await screen.findByText("Install version 0.2.0")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Install update" }));
  expect(mock.invoke).toHaveBeenCalledWith("install_update");
  expect(await screen.findByText("Downloading update")).toBeTruthy();
});

test("every settings control has an accessible name", async () => {
  render(<Settings version="0.1.14" />);
  await waitFor(() => expect(screen.getAllByRole("switch").length).toBe(2));
  for (const control of [...screen.getAllByRole("switch"), ...screen.getAllByRole("button")]) {
    expect((control.getAttribute("aria-label") ?? control.textContent ?? "").trim()).not.toBe("");
  }
});

test("the test notification button reports the request outcome", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "test_notification"
      ? Promise.resolve()
      : command === "get_preferences" ? Promise.resolve({ notification_preview: true }) : Promise.reject(new Error("x")));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await user.click(screen.getByRole("button", { name: "Send test notification" }));
  expect(mock.invoke).toHaveBeenCalledWith("test_notification");
  expect(await screen.findByText("Request sent; check Windows notifications")).toBeTruthy();
  mock.invoke.mockImplementation(() => Promise.reject(new Error("denied")));
  await user.click(screen.getByRole("button", { name: "Send test notification" }));
  expect(await screen.findByText("Notification request failed")).toBeTruthy();
});

const account = (id: string, name: string) => ({ id, name });
const config = (names: string[], layout: LayoutMode = "windows"): AccountsConfig => ({
  layout,
  split_ratio: 0.5,
  next_id: names.length + 1,
  accounts: names.map((name, index) => account(`a${index + 1}`, name)),
});

/** Backend double: preferences plus the account commands, others reject. */
function backend(initial: AccountsConfig, reply?: (command: string) => unknown) {
  mock.invoke.mockImplementation((command: string) => {
    if (command === "get_preferences") return Promise.resolve({ notification_preview: true });
    if (command === "list_accounts") return Promise.resolve(initial);
    if (reply) {
      const value = reply(command);
      if (value !== undefined) return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    return Promise.reject(new Error(`unexpected ${command}`));
  });
}

test("lists the accounts and keeps the first one from being removed", async () => {
  backend(config(["Home", "Work"]));
  render(<Settings version="0.1.14" />);
  expect(await screen.findByLabelText("Name of Home")).toBeTruthy();
  expect(screen.getByLabelText("Name of Work")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Remove Home" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Remove Work" }) as HTMLButtonElement).disabled).toBe(false);
});

test("renaming sends the exact id and trimmed name once", async () => {
  const renamed = config(["Home", "Office"]);
  backend(config(["Home", "Work"]), (command) => (command === "rename_account" ? renamed : undefined));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  const field = await screen.findByLabelText("Name of Work");
  await user.clear(field);
  await user.type(field, "  Office  ");
  await user.tab();
  expect(mock.invoke).toHaveBeenCalledWith("rename_account", { id: "a2", name: "Office" });
  expect(mock.invoke.mock.calls.filter(([command]) => command === "rename_account").length).toBe(1);
  expect(await screen.findByLabelText("Name of Office")).toBeTruthy();
});

test("an unchanged or emptied name is never sent", async () => {
  backend(config(["Home", "Work"]));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  const field = await screen.findByLabelText("Name of Work");
  await user.click(field);
  await user.tab();
  await user.clear(field);
  await user.tab();
  expect(mock.invoke).not.toHaveBeenCalledWith("rename_account", expect.anything());
});

test("adding names the account after the next number", async () => {
  backend(config(["Home", "Work"]), (command) => (command === "add_account" ? config(["Home", "Work", "Account 3"]) : undefined));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await user.click(await screen.findByRole("button", { name: "Add account" }));
  expect(mock.invoke).toHaveBeenCalledWith("add_account", { name: "Account 3" });
  expect(await screen.findByLabelText("Name of Account 3")).toBeTruthy();
});

test("a refused add says so and the limit disables the button", async () => {
  backend(config(["A", "B"]), (command) => (command === "add_account" ? new Error("limit") : undefined));
  const user = userEvent.setup();
  const { unmount } = render(<Settings version="0.1.14" />);
  await user.click(await screen.findByRole("button", { name: "Add account" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not add account");
  unmount();
  backend(config(["A", "B", "C", "D"]));
  render(<Settings version="0.1.14" />);
  await screen.findByLabelText("Name of D");
  expect((screen.getByRole("button", { name: "Add account" }) as HTMLButtonElement).disabled).toBe(true);
});

test("removing needs a confirmation and can be cancelled", async () => {
  backend(config(["Home", "Work"]), (command) => (command === "remove_account" ? config(["Home"]) : undefined));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await user.click(await screen.findByRole("button", { name: "Remove Work" }));
  expect(mock.invoke).not.toHaveBeenCalledWith("remove_account", expect.anything());
  await user.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(mock.invoke).not.toHaveBeenCalledWith("remove_account", expect.anything());
  await user.click(screen.getByRole("button", { name: "Remove Work" }));
  await user.click(await screen.findByRole("button", { name: "Remove account" }));
  expect(mock.invoke).toHaveBeenCalledWith("remove_account", { id: "a2" });
  await waitFor(() => expect(screen.queryByLabelText("Name of Work")).toBeNull());
});

test("layout choice is sent and split is unavailable beyond two accounts", async () => {
  backend(config(["A", "B"]), (command) => (command === "set_layout" ? config(["A", "B"], "split") : undefined));
  const user = userEvent.setup();
  const { unmount } = render(<Settings version="0.1.14" />);
  await user.click(await screen.findByRole("button", { name: "Split panes" }));
  expect(mock.invoke).toHaveBeenCalledWith("set_layout", { layout: "split" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Split panes" }).getAttribute("aria-pressed")).toBe("true"));
  unmount();
  backend(config(["A", "B", "C"]));
  render(<Settings version="0.1.14" />);
  await screen.findByLabelText("Name of C");
  expect((screen.getByRole("button", { name: "Split panes" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Split supports up to 2 accounts")).toBeTruthy();
});

test("Open asks the backend to show that account and changes elsewhere refresh the list", async () => {
  backend(config(["Home", "Work"]), (command) => (command === "open_account" ? null : undefined));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await user.click(await screen.findByRole("button", { name: "Open Work" }));
  expect(mock.invoke).toHaveBeenCalledWith("open_account", { id: "a2" });
  await waitFor(() => expect(mock.accounts).toBeTruthy());
  act(() => mock.accounts!({ payload: config(["Home", "Phone"]) }));
  expect(await screen.findByLabelText("Name of Phone")).toBeTruthy();
});
