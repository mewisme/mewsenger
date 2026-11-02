// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Credits } from "./credits";

const mock = vi.hoisted(() => ({
  isNative: true,
  close: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mock.isNative }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: mock.close }),
}));

beforeEach(() => {
  mock.isNative = true;
  mock.close.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

test("About displays the bundled app icon and actual app version", () => {
  render(<Credits version="0.1.14" />);
  expect(screen.getByRole("heading", { name: "Messenger" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Messenger icon" }).getAttribute("src")).toContain("128x128");
  expect(screen.getByText("Version 0.1.14")).toBeTruthy();
  expect(screen.getByText("Made by Mew")).toBeTruthy();
});

test("Close button closes the credits window", async () => {
  const user = userEvent.setup();
  render(<Credits version="0.1.14" />);
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(mock.close).toHaveBeenCalledOnce();
});

test("Close failure is visible rather than silently ignored", async () => {
  mock.close.mockRejectedValueOnce(new Error("unavailable"));
  const user = userEvent.setup();
  render(<Credits version="0.1.14" />);
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
});

test("browser preview does not expose an inert native action", () => {
  mock.isNative = false;
  render(<Credits version="Version unavailable" />);
  expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
});
