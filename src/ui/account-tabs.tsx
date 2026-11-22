import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import { AccountAvatar, accountLabel } from "@/ui/account-avatar";
import type { AccountRef, TabsView } from "@/ui/local-view";

interface TabAlert {
  title: string;
  body: string;
}

function isTabAlert(value: unknown): value is TabAlert & { account: string } {
  const payload = value as Record<string, unknown> | null;
  return typeof payload === "object" && payload !== null && typeof payload.account === "string" &&
    typeof payload.title === "string" && typeof payload.body === "string";
}

interface ConfigPayload {
  accounts: (AccountRef & { display_name?: string })[];
  open: string[];
  active: string;
}

function isPayload(value: unknown): value is ConfigPayload {
  const payload = value as ConfigPayload | null;
  return typeof payload === "object" && payload !== null &&
    Array.isArray(payload.accounts) && Array.isArray(payload.open) &&
    payload.open.every((id) => typeof id === "string") &&
    typeof payload.active === "string";
}

/** An account as a tab shows it: Messenger's name and picture, nothing the account was merely called. */
function shown(account: AccountRef & { display_name?: string; picture?: string }): AccountRef {
  return { id: account.id, name: account.display_name?.trim() ?? "", picture: account.picture };
}

const DRAG_THRESHOLD = 5;

interface TabRect {
  id: string;
  left: number;
  width: number;
}

interface DragState {
  id: string;
  pointerId: number;
  startX: number;
  started: boolean;
  rects: TabRect[];
  origin: number;
  target: number;
  shift: number;
  holder: HTMLElement;
}

interface DragView {
  id: string;
  offset: number;
  origin: number;
  target: number;
  shift: number;
}

function isShortcutAction(value: unknown): value is { action: string } {
  const payload = value as { action?: unknown } | null;
  return typeof payload === "object" && payload !== null && typeof payload.action === "string";
}

function moved(order: string[], from: number, to: number): string[] {
  const next = order.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function translation(index: number, drag: DragView | null): string | undefined {
  if (!drag) return undefined;
  if (index === drag.origin) return `translateX(${drag.offset}px)`;
  if (drag.origin < drag.target && index > drag.origin && index <= drag.target) return `translateX(${-drag.shift}px)`;
  if (drag.target < drag.origin && index >= drag.target && index < drag.origin) return `translateX(${drag.shift}px)`;
  return undefined;
}

/** Browser-style tab strip: one tab per open account plus the new-tab button. */
export function AccountTabs({ initial }: { initial: TabsView }) {
  const t = useT();
  const [view, setView] = useState<TabsView>(initial);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragView, setDragView] = useState<DragView | null>(null);
  const [alerts, setAlerts] = useState<Record<string, TabAlert>>({});
  const [settings, setSettings] = useState({ open: false, shown: false });
  const plus = useRef<HTMLButtonElement>(null);
  const holders = useRef(new Map<string, HTMLElement>());
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  function openMenu() {
    const left = plus.current?.getBoundingClientRect().left ?? 0;
    void invoke("open_tab_menu", { x: left }).catch(() => {});
  }
  const openMenuRef = useRef(openMenu);
  openMenuRef.current = openMenu;

  function cancelDrag() {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (current.started) {
      suppressClick.current = true;
      try { current.holder.releasePointerCapture(current.pointerId); } catch { /* Capture already gone. */ }
    }
    setDragView(null);
  }
  const cancelRef = useRef(cancelDrag);
  cancelRef.current = cancelDrag;

  useEffect(() => {
    let active = true;
    const detach: (() => void)[] = [];
    function subscribe(name: string, handler: (payload: unknown) => void) {
      void listen<unknown>(name, (event) => { if (active) handler(event.payload); })
        .then((unlisten) => {
          if (active) detach.push(unlisten);
          else unlisten();
        }).catch(() => { /* Tabs keep the state they were created with. */ });
    }
    subscribe("accounts-changed", (payload) => {
      if (!isPayload(payload)) return;
      cancelRef.current();
      setOrder(null);
      setView({ accounts: payload.accounts.map(shown), open: payload.open, active: payload.active });
    });
    subscribe("settings-state", (payload) => {
      const state = payload as { open?: unknown; shown?: unknown } | null;
      if (typeof state === "object" && state !== null && typeof state.open === "boolean" && typeof state.shown === "boolean") {
        setSettings({ open: state.open, shown: state.shown });
      }
    });
    subscribe("tab-alert", (payload) => {
      if (isTabAlert(payload)) setAlerts((current) => ({ ...current, [payload.account]: { title: payload.title, body: payload.body } }));
    });
    // The address of the title bar carries only what it was opened with.
    if (isTauri()) void invoke<unknown>("list_accounts").then((config) => {
      if (!active || !isPayload(config)) return;
      setView({ accounts: config.accounts.map(shown), open: config.open, active: config.active });
    }).catch(() => { /* The view from the address stays. */ });
    subscribe("tab-shortcut", (payload) => {
      if (isShortcutAction(payload) && payload.action === "new") openMenuRef.current();
    });
    return () => {
      active = false;
      detach.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && drag.current) {
        cancelRef.current();
        return;
      }
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      let action: string | null = null;
      if (event.key === "Tab") action = event.shiftKey ? "prev" : "next";
      else if (!event.shiftKey && !event.repeat && event.key.toLowerCase() === "t") action = "new";
      else if (!event.shiftKey && !event.repeat && event.key.toLowerCase() === "w") action = "close";
      if (!action) return;
      event.preventDefault();
      void invoke("tab_shortcut", { action }).catch(() => {});
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Opening a tab answers its alert.
  useEffect(() => {
    setAlerts((current) => {
      if (!(view.active in current)) return current;
      const { [view.active]: _answered, ...rest } = current;
      return rest;
    });
  }, [view.active]);

  const ids = order ?? view.open;
  const tabs = ids
    .map((id) => view.accounts.find((account) => account.id === id))
    .filter((account): account is AccountRef => account !== undefined);
  const closable = tabs.length > 1;

  function select(id: string, force: boolean) {
    if (!force && id === view.active) return;
    setView((current) => ({ ...current, active: id }));
    void invoke("open_account", { id }).catch(() => {});
  }
  function close(id: string) {
    if (!closable) return;
    void invoke("close_tab", { id }).catch(() => {});
  }
  function onMouseDown(event: MouseEvent<HTMLElement>) {
    // Activation happens on click so a drag never opens the tab.
    event.preventDefault();
  }

  function onPointerDown(event: PointerEvent<HTMLElement>, id: string) {
    if (event.button !== 0) return;
    suppressClick.current = false;
    const rects: TabRect[] = [];
    for (const account of tabs) {
      const holder = holders.current.get(account.id);
      if (!holder) return;
      const box = holder.getBoundingClientRect();
      rects.push({ id: account.id, left: box.left, width: box.width });
    }
    const origin = rects.findIndex((rect) => rect.id === id);
    if (origin < 0) return;
    const gap = rects.length > 1 ? Math.max(0, rects[1].left - (rects[0].left + rects[0].width)) : 0;
    drag.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      started: false,
      rects,
      origin,
      target: origin,
      shift: rects[origin].width + gap,
      holder: event.currentTarget,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.startX;
    if (!current.started) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      current.started = true;
      try { current.holder.setPointerCapture(current.pointerId); } catch { /* Capture unavailable. */ }
    }
    const { rects, origin } = current;
    const self = rects[origin];
    const stripLeft = rects[0].left;
    const stripRight = rects[rects.length - 1].left + rects[rects.length - 1].width;
    const offset = Math.min(Math.max(dx, stripLeft - self.left), stripRight - self.width - self.left);
    const center = self.left + self.width / 2 + offset;
    let target = 0;
    rects.forEach((rect, index) => {
      if (index === origin) return;
      const middle = rect.left + rect.width / 2;
      // Ties happen at the strip edges, where the dragged tab belongs past that neighbour.
      if (dx >= 0 ? middle <= center : middle < center) target += 1;
    });
    current.target = target;
    setDragView({ id: current.id, offset, origin, target, shift: current.shift });
  }

  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    drag.current = null;
    if (!current.started) return;
    suppressClick.current = true;
    try { current.holder.releasePointerCapture(current.pointerId); } catch { /* Capture already gone. */ }
    setDragView(null);
    if (current.target === current.origin) return;
    setOrder(moved(current.rects.map((rect) => rect.id), current.origin, current.target));
    void invoke("move_tab", { id: current.id, index: current.target }).catch(() => {});
  }

  return (
    <Tabs
      value={settings.shown ? "" : view.active}
      onValueChange={(id) => select(id, false)}
      className="h-full min-w-0 items-end gap-0.5 pl-1 data-horizontal:flex-row"
    >
      <TabsList
        aria-label={t("tabs.label")}
        className="h-9 w-auto min-w-0 items-end justify-start gap-0.5 rounded-none bg-transparent p-0"
      >
        {tabs.map((account, index) => {
          const selected = !settings.shown && account.id === view.active;
          const alert = selected ? undefined : alerts[account.id];
          const dragging = dragView?.id === account.id;
          return (
            <div
              key={account.id}
              ref={(node) => {
                if (node) holders.current.set(account.id, node);
                else holders.current.delete(account.id);
              }}
              onPointerDown={(event) => onPointerDown(event, account.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={cancelDrag}
              onClickCapture={(event) => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              style={{ transform: translation(index, dragView) }}
              className={cn(
                "@container/tab group/tab relative h-9 w-40 min-w-9 max-w-40 shrink touch-none",
                selected && "-mb-px h-[calc(2.25rem+1px)]",
                dragView && !dragging && "transition-transform duration-150",
                dragging && "z-10 shadow-md",
              )}
            >
              <TabsTrigger
                value={account.id}
                aria-label={alert ? t("tabs.newMessage", { name: accountLabel(account, t) }) : accountLabel(account, t)}
                title={alert ? `${alert.title}: ${alert.body}` : accountLabel(account, t)}
                onMouseDown={onMouseDown}
                onClick={() => select(account.id, settings.shown)}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    close(account.id);
                  }
                }}
                className={cn(
                  "h-full w-full flex-none cursor-default justify-start gap-2 overflow-hidden rounded-none border-0 px-3 text-xs font-normal shadow-none transition-colors after:hidden",
                  "bg-transparent data-active:bg-transparent data-active:shadow-none dark:bg-transparent dark:data-active:border-transparent dark:data-active:bg-transparent",
                  closable && "pr-7",
                  "@max-[71px]/tab:justify-center @max-[71px]/tab:px-0",
                  selected
                    ? "bg-background pb-px text-foreground data-active:bg-background dark:bg-background dark:data-active:bg-background"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <AccountAvatar account={account}
                  className={cn("size-5", alert && "animate-pulse ring-2 ring-primary")} />
                {alert ? (
                  <span className="tab-alert relative h-5 min-w-0 flex-1 overflow-hidden text-left @max-[71px]/tab:hidden">
                    <span className="tab-alert-name">{accountLabel(account, t)}</span>
                    <span className="tab-alert-message font-medium text-foreground">{alert.title}: {alert.body}</span>
                  </span>
                ) : (
                  <span className={cn("min-w-0 flex-1 truncate text-left @max-[71px]/tab:hidden", !account.name.trim() && "text-muted-foreground")}>
                    {accountLabel(account, t)}
                  </span>
                )}
              </TabsTrigger>
              {closable && (
                <button
                  type="button"
                  aria-label={t("tabs.closeTab", { name: accountLabel(account, t) })}
                  tabIndex={selected ? 0 : -1}
                  onClick={(event) => {
                    event.stopPropagation();
                    close(account.id);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  className={cn(
                    "absolute right-2 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center transition-colors hover:bg-foreground/10",
                    "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    // Too narrow for a label: the picture turns into the close button on hover.
                    "@max-[71px]/tab:right-1/2 @max-[71px]/tab:size-5 @max-[71px]/tab:translate-x-1/2 @max-[71px]/tab:rounded-full @max-[71px]/tab:bg-muted",
                    selected ? "opacity-100 @max-[71px]/tab:opacity-0 @max-[71px]/tab:group-hover/tab:opacity-100" : "opacity-0 group-hover/tab:opacity-100",
                  )}
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              )}
            </div>
          );
        })}
        {settings.open && (
          <div className={cn(
            "@container/tab group/tab relative h-9 w-40 min-w-9 max-w-40 shrink",
            settings.shown && "-mb-px h-[calc(2.25rem+1px)]",
          )}>
            <div role="tab" aria-selected={settings.shown} aria-label={t("titlebar.settings")} title={t("titlebar.settings")}
              onClick={() => void invoke("select_settings").catch(() => {})}
              className={cn(
                "flex h-full w-full cursor-default items-center gap-2 overflow-hidden px-3 pr-7 text-xs transition-colors",
                "@max-[71px]/tab:justify-center @max-[71px]/tab:px-0",
                settings.shown ? "bg-background pb-px text-foreground" : "text-muted-foreground hover:bg-muted",
              )}>
              <Settings aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left @max-[71px]/tab:hidden">{t("titlebar.settings")}</span>
            </div>
            <button
              type="button"
              aria-label={t("tabs.closeSettings")}
              onClick={() => void invoke("show_settings").catch(() => {})}
              className={cn(
                "absolute right-2 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "@max-[71px]/tab:right-1/2 @max-[71px]/tab:size-5 @max-[71px]/tab:translate-x-1/2 @max-[71px]/tab:rounded-full @max-[71px]/tab:bg-muted",
                settings.shown ? "opacity-100 @max-[71px]/tab:opacity-0 @max-[71px]/tab:group-hover/tab:opacity-100" : "opacity-0 group-hover/tab:opacity-100",
              )}
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </div>
        )}
      </TabsList>
      <button
        ref={plus}
        type="button"
        aria-label={t("tabs.newTab")}
        aria-haspopup="menu"
        title={t("tabs.newTab")}
        onClick={openMenu}
        className="mb-1.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </Tabs>
  );
}
