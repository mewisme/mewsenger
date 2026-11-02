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
