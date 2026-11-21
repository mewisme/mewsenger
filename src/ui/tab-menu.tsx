import { useEffect, useRef, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { TabMenuView } from "@/ui/local-view";

const ROW =
  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors " +
  "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none";

/** Dropdown under the new-tab button: closed accounts, then a fresh sign-in. */
export function TabMenu({ view }: { view: TabMenuView }) {
  const list = useRef<HTMLDivElement>(null);

  const items = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = () => invoke("close_tab_menu", {}).catch(() => {});

  useEffect(() => {
    const { body, documentElement } = document;
    const previous = [body.style.background, documentElement.style.background];
    body.style.background = "transparent";
    documentElement.style.background = "transparent";
    items()[0]?.focus();
    const dismiss = () => { void close(); };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", dismiss);
    return () => {
      body.style.background = previous[0];
      documentElement.style.background = previous[1];
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", dismiss);
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = items();
    if (rows.length === 0) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    rows[(at + step + rows.length) % rows.length].focus();
  }

  function finish(command: string, args: Record<string, unknown>) {
    void invoke(command, args).catch(() => {}).then(close);
  }

  return (
    <main className="h-screen w-full overflow-hidden">
      <div ref={list} role="menu" aria-label="Accounts" onKeyDown={onKeyDown}
        className="flex max-h-full flex-col gap-0.5 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
        {view.accounts.map((account) => (
          <button key={account.id} type="button" role="menuitem" className={ROW}
            onClick={() => finish("open_account", { id: account.id })}>
            <span aria-hidden="true"
              className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold uppercase leading-none text-primary">
              {account.name.trim()[0] ?? "?"}
            </span>
            <span className="min-w-0 flex-1 truncate">{account.name}</span>
          </button>
        ))}
        {view.accounts.length > 0 && <Separator className="my-0.5" />}
        <button type="button" role="menuitem" className={cn(ROW)}
          onClick={() => finish("add_account", { name: `Account ${view.next}` })}>
          <Plus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">Sign in to a new account</span>
        </button>
      </div>
    </main>
  );
}
