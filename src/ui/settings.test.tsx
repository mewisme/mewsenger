// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./settings";
import type { AccountInfo, AccountsConfig } from "./accounts-section";

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  isEnabled: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  handler: undefined as ((event: { payload: unknown }) => void) | undefined,
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
  // Radix Select measures and scrolls with APIs jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  localStorage.clear();
});
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

type User = ReturnType<typeof userEvent.setup>;
const openTab = (user: User, name: string) => user.click(screen.getByRole("tab", { name }));
const preview = () => screen.getByRole("switch", { name: "Show message previews in notifications" });
const savedPrefs = (extra: Record<string, unknown>) => ({ notification_preview: true, ...extra });

test("shows the stored preference and names every control", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "get_preferences"
      ? Promise.resolve({ notification_preview: false })
      : Promise.reject(new Error("x")));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  expect(screen.getByRole("switch", { name: "Launch Mewsenger when I sign in to Windows" })).toBeTruthy();
  await openTab(user, "Notifications");
  await waitFor(() => expect(preview().getAttribute("aria-checked")).toBe("false"));
  await openTab(user, "About");
  expect(screen.getByText(/Version 0\.1\.14/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "GitHub" })).toBeTruthy();
});

test("a privacy switch saves its own key", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "get_preferences"
      ? Promise.resolve(savedPrefs({ block_typing: false }))
      : Promise.resolve(savedPrefs({ block_typing: true })));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await openTab(user, "Privacy");
  const typing = () => screen.getByRole("switch", { name: "Hide that I am typing" });
  await waitFor(() => expect((typing() as HTMLButtonElement).disabled).toBe(false));
  expect(typing().getAttribute("aria-checked")).toBe("false");
  await user.click(typing());
  expect(mock.invoke).toHaveBeenCalledWith("set_preference", { key: "block_typing", value: true });
  await waitFor(() => expect(typing().getAttribute("aria-checked")).toBe("true"));
});

test("the theme choice saves through its own command", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "get_preferences"
      ? Promise.resolve(savedPrefs({ theme: "system" }))
      : Promise.resolve(savedPrefs({ theme: "dark" })));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  const dark = () => screen.getByRole("radio", { name: "Dark" });
  await waitFor(() => expect((dark() as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");
  await user.click(dark());
  expect(mock.invoke).toHaveBeenCalledWith("set_theme_preference", { value: "dark" });
  await waitFor(() => expect(dark().getAttribute("aria-checked")).toBe("true"));
});

test("toggling saves the exact key and value", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "get_preferences"
      ? Promise.resolve(savedPrefs({}))
      : Promise.resolve({ notification_preview: false }));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await openTab(user, "Notifications");
  await waitFor(() => expect((preview() as HTMLButtonElement).disabled).toBe(false));
  await user.click(preview());
  expect(mock.invoke).toHaveBeenCalledWith("set_preference", {
    key: "notification_preview",
    value: false,
  });
  await waitFor(() => expect(preview().getAttribute("aria-checked")).toBe("false"));
});

test("a change made from the tray updates the switch", async () => {
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await openTab(user, "Notifications");
  await waitFor(() => expect(mock.handler).toBeTruthy());
  await waitFor(() => expect(preview().getAttribute("aria-checked")).toBe("true"));
  act(() => mock.handler!({ payload: { notification_preview: false } }));
  await waitFor(() => expect(preview().getAttribute("aria-checked")).toBe("false"));
});

test("a failed save reverts the switch and says so", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "get_preferences"
      ? Promise.resolve(savedPrefs({}))
      : Promise.reject(new Error("disk")));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await openTab(user, "Notifications");
  await waitFor(() => expect((preview() as HTMLButtonElement).disabled).toBe(false));
  await user.click(preview());
  expect((await screen.findByRole("alert")).textContent).toBe("Could not save");
  expect(preview().getAttribute("aria-checked")).toBe("true");
});

test("autostart is read from the system and toggled through the plugin", async () => {
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  const toggle = screen.getByRole("switch", { name: "Launch Mewsenger when I sign in to Windows" });
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
  await user.click(toggle);
  expect(mock.enable).toHaveBeenCalledOnce();
  await user.click(toggle);
  expect(mock.disable).toHaveBeenCalledOnce();
});

test("closing to the tray is a preference of its own", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "get_preferences"
      ? Promise.resolve(savedPrefs({ close_to_tray: false }))
      : Promise.resolve(savedPrefs({ close_to_tray: true })));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  const toggle = () => screen.getByRole("switch", { name: "Close button hides to tray" });
  await waitFor(() => expect((toggle() as HTMLButtonElement).disabled).toBe(false));
  await user.click(toggle());
  expect(mock.invoke).toHaveBeenCalledWith("set_preference", { key: "close_to_tray", value: true });
  await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("true"));
});

test("copy diagnostics writes exactly what the backend returned", async () => {
  const diagnostics = { app_version: "0.1.14", os: "windows", session: true, unread_known: false };
  mock.invoke.mockImplementation((command: string) =>
    command === "get_diagnostics"
      ? Promise.resolve(diagnostics)
      : command === "get_preferences"
        ? Promise.resolve(savedPrefs({}))
        : Promise.reject(new Error("x")));
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  render(<Settings version="0.1.14" />);
  await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(diagnostics, null, 2)));
});

function updateBackend(state: unknown, prefs: Record<string, unknown> = {}) {
  mock.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "get_update_state": return Promise.resolve(state);
      case "get_preferences": return Promise.resolve(savedPrefs({ check_on_start: true, auto_install: false, update_schedule: "daily", ...prefs }));
      case "install_update": return Promise.resolve({ state: "downloading" });
      case "set_preference": return Promise.resolve(savedPrefs({ check_on_start: true, auto_install: false, update_schedule: "daily", ...prefs, [args!.key as string]: args!.value }));
      case "set_update_schedule": return Promise.resolve(savedPrefs({ update_schedule: args!.value }));
      default: return Promise.reject(new Error(`unexpected ${command}`));
    }
  });
}

test("update section follows the update state and installs when one is available", async () => {
  updateBackend({ state: "available", version: "0.2.0" });
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await openTab(user, "Updates");
  expect(await screen.findByText("Install version 0.2.0")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Install update" }));
  expect(mock.invoke).toHaveBeenCalledWith("install_update");
  expect(await screen.findByText("Downloading update")).toBeTruthy();
});

test("update preferences save their own keys and the schedule has its own command", async () => {
  updateBackend({ state: "idle" });
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await openTab(user, "Updates");
  const startup = () => screen.getByRole("switch", { name: "Check for updates on startup" });
  await waitFor(() => expect((startup() as HTMLButtonElement).disabled).toBe(false));
  await user.click(startup());
  expect(mock.invoke).toHaveBeenCalledWith("set_preference", { key: "check_on_start", value: false });
  await user.click(screen.getByRole("switch", { name: "Install updates automatically" }));
  expect(mock.invoke).toHaveBeenCalledWith("set_preference", { key: "auto_install", value: true });

  await user.click(screen.getByRole("combobox", { name: "Automatically check" }));
  await user.click(await screen.findByRole("option", { name: "Every 6 hours" }));
  expect(mock.invoke).toHaveBeenCalledWith("set_update_schedule", { value: "every_6_hours" });
});

test("update preferences are disabled and explained when updates are not configured", async () => {
  updateBackend({ state: "unconfigured" });
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await openTab(user, "Updates");
  expect(await screen.findByText("Updates are not available in this build.")).toBeTruthy();
  expect((screen.getByRole("switch", { name: "Install updates automatically" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Check for updates" }) as HTMLButtonElement).disabled).toBe(true);
});

test("the language choice is stored and switches the labels at once", async () => {
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await user.click(screen.getByRole("combobox", { name: "Language" }));
  await user.click(await screen.findByRole("option", { name: "Tiếng Việt" }));
  expect(localStorage.getItem("mew-language")).toBe("vi");
  expect(await screen.findByRole("tab", { name: "Tài khoản" })).toBeTruthy();
});

test("every settings control has an accessible name", async () => {
  render(<Settings version="0.1.14" />);
  await waitFor(() => expect(screen.getAllByRole("switch").length).toBe(7));
  for (const control of [...screen.getAllByRole("switch"), ...screen.getAllByRole("button")]) {
    expect((control.getAttribute("aria-label") ?? control.textContent ?? "").trim()).not.toBe("");
  }
});

test("the test notification button reports the request outcome", async () => {
  mock.invoke.mockImplementation((command: string) =>
    command === "test_notification"
      ? Promise.resolve()
      : command === "get_preferences" ? Promise.resolve(savedPrefs({})) : Promise.reject(new Error("x")));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await openTab(user, "Notifications");
  await user.click(screen.getByRole("button", { name: "Send test notification" }));
  expect(mock.invoke).toHaveBeenCalledWith("test_notification");
  expect(await screen.findByText("Request sent; check Windows notifications")).toBeTruthy();
  mock.invoke.mockImplementation(() => Promise.reject(new Error("denied")));
  await user.click(screen.getByRole("button", { name: "Send test notification" }));
  expect(await screen.findByText("Notification request failed")).toBeTruthy();
});

test("About opens the project pages through the app", async () => {
  mock.invoke.mockImplementation(() => Promise.resolve(undefined));
  const user = userEvent.setup();
  render(<Settings version="0.1.14" />);
  await openTab(user, "About");
  await user.click(screen.getByRole("button", { name: "GitHub" }));
  await user.click(screen.getByRole("button", { name: "Releases" }));
  await user.click(screen.getByRole("button", { name: "Report an issue" }));
  await user.click(screen.getByRole("button", { name: "License: MIT" }));
  for (const page of ["repo", "releases", "issues", "license"]) {
    expect(mock.invoke).toHaveBeenCalledWith("open_project_link", { page });
  }
});

test("settings have no close button of their own", () => {
  render(<Settings version="0.1.14" />);
  expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
});

const account = (id: string, name?: string): AccountInfo => ({ id, name: `Account ${id}`, ...(name ? { display_name: name } : {}) });
const config = (names: (string | undefined)[], open: string[] = ["a1"], active = "a1"): AccountsConfig => ({
  active,
  open,
  next_id: names.length + 1,
  accounts: names.map((name, index) => account(`a${index + 1}`, name)),
});

/** Backend double: preferences plus the account commands, others reject. */
function backend(initial: AccountsConfig, reply?: (command: string) => unknown) {
  mock.invoke.mockImplementation((command: string) => {
    if (command === "get_preferences") return Promise.resolve(savedPrefs({}));
    if (command === "list_accounts") return Promise.resolve(initial);
    if (reply) {
      const value = reply(command);
      if (value !== undefined) return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    return Promise.reject(new Error(`unexpected ${command}`));
  });
}

async function openAccounts(user: User) {
  render(<Settings version="0.1.14" />);
  await openTab(user, "Accounts");
}

test("lists the accounts by Messenger's name and keeps the first one from being removed", async () => {
  backend(config(["Home", "Work"]));
  const user = userEvent.setup();
  await openAccounts(user);
  expect(await screen.findByText("Home")).toBeTruthy();
  expect(screen.getByText("Work")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Remove Home" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Remove Work" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByLabelText(/Name of/)).toBeNull();
});

test("an account that is not signed in is Anonymous, never its internal name", async () => {
  backend(config(["Home", undefined]));
  const user = userEvent.setup();
  await openAccounts(user);
  expect(await screen.findByText("Anonymous")).toBeTruthy();
  expect(screen.queryByText(/Account a2/)).toBeNull();
  expect(screen.getByRole("button", { name: "Remove Anonymous" })).toBeTruthy();
});

test("there is no account limit: adding stays available and names the account after the next number", async () => {
  backend(config(["Ann", "Bob", "Cat", "Dan", "Eve"]), (command) => (command === "add_account" ? config(["Ann", "Bob", "Cat", "Dan", "Eve", "Fay"]) : undefined));
  const user = userEvent.setup();
  await openAccounts(user);
  await screen.findByText("Eve");
  const add = screen.getByRole("button", { name: "Add account" }) as HTMLButtonElement;
  expect(add.disabled).toBe(false);
  expect(screen.queryByText(/of 4/)).toBeNull();
  await user.click(add);
  expect(mock.invoke).toHaveBeenCalledWith("add_account", { name: "Account 6" });
  expect(await screen.findByText("Fay")).toBeTruthy();
});

test("a refused add says so", async () => {
  backend(config(["A", "B"]), (command) => (command === "add_account" ? new Error("nope") : undefined));
  const user = userEvent.setup();
  await openAccounts(user);
  await user.click(await screen.findByRole("button", { name: "Add account" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not add account");
});

test("removing needs a confirmation and can be cancelled", async () => {
  backend(config(["Home", "Work"]), (command) => (command === "remove_account" ? config(["Home"]) : undefined));
  const user = userEvent.setup();
  await openAccounts(user);
  await user.click(await screen.findByRole("button", { name: "Remove Work" }));
  expect(mock.invoke).not.toHaveBeenCalledWith("remove_account", expect.anything());
  await user.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(mock.invoke).not.toHaveBeenCalledWith("remove_account", expect.anything());
  await user.click(screen.getByRole("button", { name: "Remove Work" }));
  await user.click(await screen.findByRole("button", { name: "Remove account" }));
  expect(mock.invoke).toHaveBeenCalledWith("remove_account", { id: "a2" });
  await waitFor(() => expect(screen.queryByText("Work")).toBeNull());
});

test("rows tell which account is showing, open in a tab, or closed, and the button matches", async () => {
  backend(config(["Home", "Work", "Spare"], ["a1", "a2"], "a2"), (command) => (command === "open_account" ? null : undefined));
  const user = userEvent.setup();
  await openAccounts(user);
  await screen.findByText("Home");
  expect(screen.getAllByText("Showing").length).toBe(1);
  expect(screen.getAllByText("Open").length).toBe(1);
  const work = screen.getByRole("button", { name: "Open Work" }) as HTMLButtonElement;
  expect(work.disabled).toBe(true);
  expect(work.textContent).toBe("Switch");
  expect(screen.getByRole("button", { name: "Open Home" }).textContent).toBe("Switch");
  expect(screen.getByRole("button", { name: "Open Spare" }).textContent).toBe("Open tab");
  await user.click(screen.getByRole("button", { name: "Open Home" }));
  expect(mock.invoke).toHaveBeenCalledWith("open_account", { id: "a1" });
  await user.click(screen.getByRole("button", { name: "Open Spare" }));
  expect(mock.invoke).toHaveBeenCalledWith("open_account", { id: "a3" });
});

test("changes announced elsewhere refresh the list", async () => {
  backend(config(["Home", "Work"]));
  const user = userEvent.setup();
  await openAccounts(user);
  await screen.findByText("Work");
  await waitFor(() => expect(mock.accounts).toBeTruthy());
  act(() => mock.accounts!({ payload: config(["Home", "Phone"]) }));
  expect(await screen.findByText("Phone")).toBeTruthy();
});
