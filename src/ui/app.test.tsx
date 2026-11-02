// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesktopApp } from "./app";

const runtime = vi.hoisted(() => ({
  available: true,
  getVersion: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => runtime.available }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: runtime.getVersion }));

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
  runtime.getVersion.mockReset().mockResolvedValue("2.3.4");
});

test("reads installed app version using the trusted Tauri API", async () => {
  render(<DesktopApp />);
  expect((await screen.findByLabelText("Application version")).textContent).toBe("2.3.4");
  expect(runtime.getVersion).toHaveBeenCalledOnce();
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Status unavailable");
  expect(screen.getByLabelText("Unread conversations").textContent).toBe("–");
});

test("does not invent version data outside the Tauri runtime", () => {
  runtime.available = false;
  render(<DesktopApp />);
  expect(screen.getByLabelText("Application version").textContent).toBe("Version unavailable");
  expect(runtime.getVersion).not.toHaveBeenCalled();
});

test("opens credits details via the status bar", async () => {
  const user = userEvent.setup();
  render(<DesktopApp />);
  await user.click(screen.getByRole("button", { name: "Credits" }));
  expect((await screen.findByRole("dialog")).textContent).toContain("Messenger desktop");
  expect(screen.getByText("Made by Mew")).toBeTruthy();
});
