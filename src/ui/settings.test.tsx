// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./settings";

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  isEnabled: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  handler: undefined as ((event: { payload: { notification_preview: boolean } }) => void) | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
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
  mock.invoke.mockReset().mockImplementation((command: string) =>
    command === "get_preferences"
      ? Promise.resolve({ notification_preview: true })
      : Promise.reject(new Error(`unexpected ${command}`)));
  mock.listen.mockReset().mockImplementation((_: string, handler: typeof mock.handler) => {
    mock.handler = handler;
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
  expect(screen.getByText("Version 0.1.14")).toBeTruthy();
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
