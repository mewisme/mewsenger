// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusBar } from "./status-bar";

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

test("has no connection or unread segment, only the right-hand controls", () => {
  render(<StatusBar onSettings={() => {}} />);
  expect(screen.getByRole("contentinfo", { name: "Application status" })).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByLabelText(/Unread conversations/)).toBeNull();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Updates" })).toBeNull();
});

test("settings button can be activated with the keyboard", async () => {
  const onSettings = vi.fn();
  const user = userEvent.setup();
  render(<StatusBar onSettings={onSettings} />);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" }));
  await user.keyboard("{Enter}");
  expect(onSettings).toHaveBeenCalledOnce();
});

test("update button follows the update state", async () => {
  const onUpdate = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(
    <StatusBar update={{ state: "available", version: "0.2.0" }} onUpdate={onUpdate} />,
  );
  const button = screen.getByRole("button", { name: "Updates" }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  await user.click(button);
  expect(onUpdate).toHaveBeenCalledOnce();
  rerender(<StatusBar update={{ state: "downloading" }} onUpdate={onUpdate} />);
  expect((screen.getByRole("button", { name: "Updates" }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<StatusBar update={{ state: "unconfigured" }} onUpdate={onUpdate} />);
  expect(screen.queryByRole("button", { name: "Updates" })).toBeNull();
});

test("download indicator reports state and reveals only a finished file", async () => {
  const reveal = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(
    <StatusBar download={{ state: "downloading", file_name: "a.pdf" }} onRevealDownload={reveal} />,
  );
  const button = () => screen.getByRole("button", { name: "Download status" }) as HTMLButtonElement;
  expect(button().disabled).toBe(true);
  rerender(<StatusBar download={{ state: "done", file_name: "a.pdf" }} onRevealDownload={reveal} />);
  await user.click(button());
  expect(reveal).toHaveBeenCalledOnce();
  rerender(<StatusBar download={{ state: "failed", file_name: "a.pdf" }} onRevealDownload={reveal} />);
  expect(button().disabled).toBe(true);
});
