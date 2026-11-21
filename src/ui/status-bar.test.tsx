// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusBar, type ConnectionState } from "./status-bar";

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

const one = (connection: ConnectionState, unreadCount: number | null) =>
  [{ id: "a1", name: "Account 1", connection, unreadCount }];

test("renders factual unknown connectivity and unread count", () => {
  render(<StatusBar accounts={one("unknown", 2)} />);
  expect(screen.getByRole("contentinfo", { name: "Application status" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Status unavailable");
  expect(screen.getByLabelText("Unread conversations").textContent).toBe("2");
  expect(screen.queryByRole("button", { name: "Updates" })).toBeNull();
});

test("connection and unread counts update without claiming online by default", () => {
  const { rerender } = render(<StatusBar accounts={one("unknown", 0)} />);
  rerender(<StatusBar accounts={one("offline", -5)} />);
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Offline");
  expect(screen.getByLabelText("Unread conversations").textContent).toBe("0");
});

test("settings button can be activated with the keyboard", async () => {
  const onSettings = vi.fn();
  const user = userEvent.setup();
  render(<StatusBar accounts={one("connected", 1)} onSettings={onSettings} />);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" }));
  await user.keyboard("{Enter}");
  expect(onSettings).toHaveBeenCalledOnce();
});

test("update button follows the update state", async () => {
  const onUpdate = vi.fn();
  const user = userEvent.setup();
  const accounts = one("connected", 0);
  const { rerender } = render(
    <StatusBar accounts={accounts} update={{ state: "available", version: "0.2.0" }} onUpdate={onUpdate} />,
  );
  const button = screen.getByRole("button", { name: "Updates" }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  await user.click(button);
  expect(onUpdate).toHaveBeenCalledOnce();
  rerender(<StatusBar accounts={accounts} update={{ state: "downloading" }} onUpdate={onUpdate} />);
  expect((screen.getByRole("button", { name: "Updates" }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<StatusBar accounts={accounts} update={{ state: "unconfigured" }} onUpdate={onUpdate} />);
  expect(screen.queryByRole("button", { name: "Updates" })).toBeNull();
});

test("signed-out sessions are shown as such", () => {
  render(<StatusBar accounts={one("signed_out", null)} />);
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Signed out");
});

test("download indicator reports state and reveals only a finished file", async () => {
  const reveal = vi.fn();
  const user = userEvent.setup();
  const accounts = one("connected", 0);
  const { rerender } = render(
    <StatusBar accounts={accounts} download={{ state: "downloading", file_name: "a.pdf" }} onRevealDownload={reveal} />,
  );
  const button = () => screen.getByRole("button", { name: "Download status" }) as HTMLButtonElement;
  expect(button().disabled).toBe(true);
  rerender(
    <StatusBar accounts={accounts} download={{ state: "done", file_name: "a.pdf" }} onRevealDownload={reveal} />,
  );
  await user.click(button());
  expect(reveal).toHaveBeenCalledOnce();
  rerender(
    <StatusBar accounts={accounts} download={{ state: "failed", file_name: "a.pdf" }} onRevealDownload={reveal} />,
  );
  expect(button().disabled).toBe(true);
});

test("each account gets its own named connection and unread segment", () => {
  render(
    <StatusBar
      accounts={[
        { id: "a1", name: "Home", connection: "connected", unreadCount: 2 },
        { id: "a2", name: "Work", connection: "signed_out", unreadCount: null },
      ]}
    />,
  );
  expect(screen.getByRole("status", { name: "Connection status: Home" }).textContent).toBe("HomeConnected");
  expect(screen.getByRole("status", { name: "Connection status: Work" }).textContent).toBe("WorkSigned out");
  expect(screen.getByLabelText("Unread conversations: Home").textContent).toBe("2");
  expect(screen.getByLabelText("Unread conversations: Work").textContent).toBe("–");
  expect(screen.queryByRole("status", { name: "Connection status" })).toBeNull();
});

test("the account name is not repeated when only one account is shown", () => {
  render(<StatusBar accounts={one("connected", 0)} />);
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).not.toContain("Account 1");
});
