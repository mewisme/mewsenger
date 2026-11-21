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

test("renders factual version, unknown connectivity and unread count", () => {
  render(
    <StatusBar version="0.1.14" connection="unknown" unreadCount={2} onCredits={() => {}} />,
  );
  expect(screen.getByRole("contentinfo", { name: "Application status" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Status unavailable");
  expect(screen.getByLabelText("Application version").textContent).toBe("0.1.14");
  expect(screen.getByLabelText("Unread conversations").textContent).toBe("2");
  expect((screen.getByRole("button", { name: "Updates unavailable" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Test desktop notifications" }) as HTMLButtonElement).disabled).toBe(true);
});

test("connection and unread counts update without claiming online by default", () => {
  const { rerender } = render(
    <StatusBar version="0.1.14" connection="unknown" unreadCount={0} onCredits={() => {}} />,
  );
  rerender(<StatusBar version="0.1.14" connection="offline" unreadCount={-5} onCredits={() => {}} />);
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Offline");
  expect(screen.getByLabelText("Unread conversations").textContent).toBe("0");
});

test("credits button can be activated with the keyboard", async () => {
  const onCredits = vi.fn();
  const user = userEvent.setup();
  render(<StatusBar version="0.1.14" connection="connected" unreadCount={1} onCredits={onCredits} />);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Credits" }));
  await user.keyboard("{Enter}");
  expect(onCredits).toHaveBeenCalledOnce();
});

test("update button follows the update state", async () => {
  const onUpdate = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(
    <StatusBar version="1" connection="connected" unreadCount={0} onCredits={() => {}}
      update={{ state: "available", version: "0.2.0" }} onUpdate={onUpdate} />,
  );
  const button = screen.getByRole("button", { name: "Updates" }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  await user.click(button);
  expect(onUpdate).toHaveBeenCalledOnce();
  rerender(
    <StatusBar version="1" connection="connected" unreadCount={0} onCredits={() => {}}
      update={{ state: "downloading" }} onUpdate={onUpdate} />,
  );
  expect((screen.getByRole("button", { name: "Updates" }) as HTMLButtonElement).disabled).toBe(true);
  rerender(
    <StatusBar version="1" connection="connected" unreadCount={0} onCredits={() => {}}
      update={{ state: "unconfigured" }} onUpdate={onUpdate} />,
  );
  expect((screen.getByRole("button", { name: "Updates unavailable" }) as HTMLButtonElement).disabled).toBe(true);
});

test("signed-out sessions are shown as such", () => {
  render(<StatusBar version="1" connection="signed_out" unreadCount={null} onCredits={() => {}} />);
  expect(screen.getByRole("status", { name: "Connection status" }).textContent).toBe("Signed out");
});

test("download indicator reports state and reveals only a finished file", async () => {
  const reveal = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(
    <StatusBar version="1" connection="connected" unreadCount={0} onCredits={() => {}}
      download={{ state: "downloading", file_name: "a.pdf" }} onRevealDownload={reveal} />,
  );
  const button = () => screen.getByRole("button", { name: "Download status" }) as HTMLButtonElement;
  expect(button().disabled).toBe(true);
  rerender(
    <StatusBar version="1" connection="connected" unreadCount={0} onCredits={() => {}}
      download={{ state: "done", file_name: "a.pdf" }} onRevealDownload={reveal} />,
  );
  await user.click(button());
  expect(reveal).toHaveBeenCalledOnce();
  rerender(
    <StatusBar version="1" connection="connected" unreadCount={0} onCredits={() => {}}
      download={{ state: "failed", file_name: "a.pdf" }} onRevealDownload={reveal} />,
  );
  expect(button().disabled).toBe(true);
});
