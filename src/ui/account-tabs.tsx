import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccountRef, TabsView } from "@/ui/local-view";

interface ConfigPayload {
  accounts: AccountRef[];
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

/** Browser-style tab strip: one tab per open account plus the new-tab button. */
export function AccountTabs({ initial }: { initial: TabsView }) {
  const [view, setView] = useState<TabsView>(initial);
  const plus = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    let detach: (() => void) | undefined;
    void listen<ConfigPayload>("accounts-changed", (event) => {
      if (active && isPayload(event.payload)) {
        const { accounts, open, active: current } = event.payload;
        setView({ accounts, open, active: current });
      }
    }).then((unlisten) => {
      if (active) detach = unlisten;
      else unlisten();
    }).catch(() => { /* Tabs keep the state they were created with. */ });
    return () => {
      active = false;
      detach?.();
    };
  }, []);

  const tabs = view.open
    .map((id) => view.accounts.find((account) => account.id === id))
    .filter((account): account is AccountRef => account !== undefined);
  const closable = tabs.length > 1;

  function select(id: string) {
    setView((current) => ({ ...current, active: id }));
    void invoke("open_account", { id }).catch(() => {});
  }
  function close(id: string) {
    if (!closable) return;
    void invoke("close_tab", { id }).catch(() => {});
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, id: string) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(id);
    }
  }
  function onMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.button === 1) event.preventDefault();
  }
  function openMenu() {
    const left = plus.current?.getBoundingClientRect().left ?? 0;
    void invoke("open_tab_menu", { x: left }).catch(() => {});
  }

  return (
    <div className="flex h-full min-w-0 items-end gap-0.5 pl-1">
      <div role="tablist" aria-label="Accounts" className="flex h-8 min-w-0 items-end gap-0.5">
        {tabs.map((account) => {
          const selected = account.id === view.active;
          return (
            <div
              key={account.id}
              role="tab"
              tabIndex={0}
              aria-selected={selected}
              aria-label={account.name}
              title={account.name}
              onClick={() => select(account.id)}
              onKeyDown={(event) => onKeyDown(event, account.id)}
              onMouseDown={onMouseDown}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  close(account.id);
                }
              }}
              className={cn(
                "group/tab relative flex h-8 w-40 min-w-24 max-w-40 shrink cursor-default items-center gap-2 rounded-t-lg px-2 text-xs transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "-mb-px h-[calc(2rem+1px)] bg-background pb-px text-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <span aria-hidden="true"
                className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold uppercase leading-none text-primary">
                {account.name.trim()[0] ?? "?"}
              </span>
              <span className="min-w-0 flex-1 truncate">{account.name}</span>
              {closable && (
                <button
                  type="button"
                  aria-label={`Close tab ${account.name}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={(event) => {
                    event.stopPropagation();
                    close(account.id);
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-foreground/10",
                    "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100",
                  )}
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        ref={plus}
        type="button"
        aria-label="New tab"
        aria-haspopup="menu"
        title="New tab"
        onClick={openMenu}
        className="mb-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
