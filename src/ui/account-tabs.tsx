import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import type { TabsView } from "@/ui/local-view";

interface ConfigPayload {
  accounts: { id: string; name: string }[];
  active: string;
}

function isPayload(value: unknown): value is ConfigPayload {
  const payload = value as ConfigPayload | null;
  return typeof payload === "object" && payload !== null &&
    Array.isArray(payload.accounts) && typeof payload.active === "string";
}

/** One tab per account in the single-window title bar. */
export function AccountTabs({ initial }: { initial: TabsView }) {
  const [view, setView] = useState<TabsView>(initial);

  useEffect(() => {
    let active = true;
    let detach: (() => void) | undefined;
    void listen<ConfigPayload>("accounts-changed", (event) => {
      if (active && isPayload(event.payload)) {
        setView({ accounts: event.payload.accounts, active: event.payload.active });
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

  return (
    <div role="tablist" aria-label="Accounts" className="flex h-full min-w-0 items-center gap-1 px-2">
      {view.accounts.map((account) => (
        <button
          key={account.id}
          type="button"
          role="tab"
          aria-selected={account.id === view.active}
          onClick={() => {
            setView((current) => ({ ...current, active: account.id }));
            void invoke("switch_account", { id: account.id }).catch(() => {});
          }}
          className={cn(
            "h-7 max-w-36 truncate rounded-md px-3 text-xs font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            account.id === view.active
              ? "bg-primary/15 text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {account.name}
        </button>
      ))}
    </div>
  );
}
