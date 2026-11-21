// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabMenu } from "./tab-menu";

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke, isTauri: () => true }));

beforeEach(() => {
  mock.invoke.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

const view = (names: string[], next = 3) => ({
  accounts: names.map((name, index) => ({ id: `a${index + 2}`, name })),
  next,
});

test("lists closed accounts, a separator, then the sign-in row last", () => {
  render(<TabMenu view={view(["Work", "Spare"])} />);
  const rows = screen.getAllByRole("menuitem");
  expect(rows.map((row) => row.textContent)).toEqual(["WWork", "SSpare", "Sign in to a new account"]);
  expect(screen.getByRole("menu").querySelector('[data-slot="separator"]')).toBeTruthy();
  expect(document.activeElement).toBe(rows[0]);
});

test("with no closed accounts only the sign-in row remains and it has the focus", () => {
  render(<TabMenu view={view([])} />);
  const rows = screen.getAllByRole("menuitem");
  expect(rows.length).toBe(1);
  expect(screen.getByRole("menu").querySelector('[data-slot="separator"]')).toBeNull();
  expect(document.activeElement).toBe(rows[0]);
});

test("selecting an account opens it and then closes the menu", async () => {
  const user = userEvent.setup();
  render(<TabMenu view={view(["Work"])} />);
  await user.click(screen.getByRole("menuitem", { name: /Work/ }));
  await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("close_tab_menu", {}));
  expect(mock.invoke.mock.calls.map(([command]) => command)).toEqual(["open_account", "close_tab_menu"]);
  expect(mock.invoke).toHaveBeenCalledWith("open_account", { id: "a2" });
});

test("signing in to a new account names it after the next number", async () => {
  const user = userEvent.setup();
  render(<TabMenu view={view(["Work"], 7)} />);
  await user.click(screen.getByRole("menuitem", { name: "Sign in to a new account" }));
  await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("close_tab_menu", {}));
  expect(mock.invoke.mock.calls.map(([command]) => command)).toEqual(["add_account", "close_tab_menu"]);
  expect(mock.invoke).toHaveBeenCalledWith("add_account", { name: "Account 7" });
});

test("Escape and losing focus close the menu", () => {
  const { unmount } = render(<TabMenu view={view(["Work"])} />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(mock.invoke).toHaveBeenCalledTimes(1);
  expect(mock.invoke).toHaveBeenLastCalledWith("close_tab_menu", {});
  fireEvent.blur(window);
  expect(mock.invoke).toHaveBeenCalledTimes(2);
  unmount();
  fireEvent.blur(window);
  expect(mock.invoke).toHaveBeenCalledTimes(2);
});

test("arrow keys move the focus around the rows", async () => {
  const user = userEvent.setup();
  render(<TabMenu view={view(["Work"])} />);
  const rows = screen.getAllByRole("menuitem");
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(rows[1]);
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(rows[0]);
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(rows[1]);
});
