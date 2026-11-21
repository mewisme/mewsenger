import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppWindow, Columns2, PanelTop, Plus, Repeat, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface AccountInfo {
  id: string;
  name: string;
}

export type LayoutMode = "windows" | "switch" | "split";
export type SettingsPlacement = "window" | "overlay";

export interface AccountsConfig {
  layout: LayoutMode;
  settings: SettingsPlacement;
  active: string;
  split_ratio: number;
  next_id: number;
  accounts: AccountInfo[];
}

export const MAX_ACCOUNTS = 4;
export const MAX_SPLIT_ACCOUNTS = 2;
const FIRST_ACCOUNT = "a1";

function isConfig(value: unknown): value is AccountsConfig {
  return typeof value === "object" && value !== null &&
    Array.isArray((value as AccountsConfig).accounts);
}

function Choice({ icon, label, hint, checked, disabled, onSelect }: {
  icon: ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 flex-1 flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
      )}
    >
      <span aria-hidden="true" className="text-muted-foreground">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

export function AccountsSection() {
  const [config, setConfig] = useState<AccountsConfig | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<AccountInfo | null>(null);

  useEffect(() => {
    let active = true;
    let detach: (() => void) | undefined;
    void listen<AccountsConfig>("accounts-changed", (event) => {
      if (active && isConfig(event.payload)) setConfig(event.payload);
    }).then((unlisten) => {
      if (active) detach = unlisten;
      else unlisten();
    }).catch(() => { /* The commands below still return the new list. */ });
    void invoke<AccountsConfig>("list_accounts")
      .then((value) => {
        if (!active) return;
        if (isConfig(value)) setConfig(value);
        else setMessage("Could not load accounts");
      })
      .catch(() => { if (active) setMessage("Could not load accounts"); });
    return () => {
      active = false;
      detach?.();
    };
  }, []);

  function run(command: string, args: Record<string, unknown>, failure: string) {
    setMessage(null);
    invoke<AccountsConfig>(command, args)
      .then((value) => (isConfig(value) ? setConfig(value) : setMessage(failure)))
      .catch(() => setMessage(failure));
  }

  if (config === null) {
    return (
      <section aria-labelledby="settings-accounts">
        <h2 id="settings-accounts" className="text-sm font-semibold">Accounts</h2>
        {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
      </section>
    );
  }

  const count = config.accounts.length;
  const splitAllowed = count <= MAX_SPLIT_ACCOUNTS;
  const draftOf = (account: AccountInfo) => drafts[account.id] ?? account.name;
  const shown = config.layout === "switch" && count > 1 ? config.active : null;

  function commitRename(account: AccountInfo) {
    const name = draftOf(account).trim();
    setDrafts(({ [account.id]: _discarded, ...rest }) => rest);
    if (name === "" || name === account.name) return;
    run("rename_account", { id: account.id, name }, "Could not rename account");
  }

  return (
    <>
      <section aria-labelledby="settings-accounts" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="settings-accounts" className="text-sm font-semibold">Accounts</h2>
          <span className="text-xs text-muted-foreground">{count} of {MAX_ACCOUNTS}</span>
        </div>
        <ul className="flex flex-col gap-2">
          {config.accounts.map((account) => (
            <li key={account.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-2">
              <span aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold uppercase text-primary">
                {(draftOf(account).trim()[0] ?? "?")}
              </span>
              <input
                type="text"
                aria-label={`Name of ${account.name}`}
                value={draftOf(account)}
                maxLength={24}
                onChange={(event) => setDrafts({ ...drafts, [account.id]: event.target.value })}
                onBlur={() => commitRename(account)}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-input focus:border-input focus:outline-none"
              />
              {shown === account.id && <Badge variant="secondary">Showing</Badge>}
              <Button type="button" variant="secondary" size="sm"
                aria-label={`Open ${account.name}`}
                disabled={shown === account.id}
                onClick={() => {
                  setMessage(null);
                  invoke("open_account", { id: account.id })
                    .catch(() => setMessage("Could not open account"));
                }}>
                {config.layout === "switch" ? "Switch" : "Open"}
              </Button>
              <Button type="button" variant="ghost" size="icon-sm"
                aria-label={`Remove ${account.name}`}
                title={account.id === FIRST_ACCOUNT ? "The first account cannot be removed" : "Remove"}
                disabled={account.id === FIRST_ACCOUNT}
                className="text-destructive hover:text-destructive"
                onClick={() => setPendingRemoval(account)}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm"
          disabled={count >= MAX_ACCOUNTS}
          className="border-dashed"
          onClick={() => run("add_account", { name: `Account ${config.next_id}` }, "Could not add account")}>
          <Plus aria-hidden="true" />
          Add account
        </Button>
        <p className="text-xs text-muted-foreground">
          {count >= MAX_ACCOUNTS ? `Up to ${MAX_ACCOUNTS} accounts.` : "Each account keeps its own login."}
        </p>
      </section>

      <section aria-labelledby="settings-layout" className="flex flex-col gap-2">
        <h2 id="settings-layout" className="text-sm font-semibold">Layout</h2>
        <div role="radiogroup" aria-labelledby="settings-layout" className="flex gap-2">
          <Choice icon={<AppWindow className="size-4" />} label="Separate windows"
            hint="One window per account"
            checked={config.layout === "windows"}
            onSelect={() => run("set_layout", { layout: "windows" }, "Could not change layout")} />
          <Choice icon={<Repeat className="size-4" />} label="Single window"
            hint="Switch accounts from the title bar"
            checked={config.layout === "switch"}
            onSelect={() => run("set_layout", { layout: "switch" }, "Could not change layout")} />
          <Choice icon={<Columns2 className="size-4" />} label="Split panes"
            hint={splitAllowed ? "Two accounts side by side" : "Split supports up to 2 accounts"}
            checked={config.layout === "split"}
            disabled={!splitAllowed}
            onSelect={() => run("set_layout", { layout: "split" }, "Could not change layout")} />
        </div>
        <p className="text-xs text-muted-foreground">
          Your layout and the account you used last are restored when Messenger starts.
        </p>
      </section>

      <section aria-labelledby="settings-placement" className="flex flex-col gap-2">
        <h2 id="settings-placement" className="text-sm font-semibold">Open settings</h2>
        <div role="radiogroup" aria-labelledby="settings-placement" className="flex gap-2">
          <Choice icon={<AppWindow className="size-4" />} label="In a window"
            hint="Its own window"
            checked={config.settings === "window"}
            onSelect={() => run("set_settings_placement", { placement: "window" }, "Could not change where settings open")} />
          <Choice icon={<PanelTop className="size-4" />} label="Over the page"
            hint="On top of the main window"
            checked={config.settings === "overlay"}
            onSelect={() => run("set_settings_placement", { placement: "overlay" }, "Could not change where settings open")} />
        </div>
        <p className="text-xs text-muted-foreground">Applies the next time settings open.</p>
      </section>

      {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
      <Dialog open={pendingRemoval !== null}
        onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {pendingRemoval?.name}?</DialogTitle>
            <DialogDescription>
              This signs the account out and deletes its data on this computer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPendingRemoval(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => {
              if (pendingRemoval) {
                run("remove_account", { id: pendingRemoval.id }, "Could not remove account");
              }
              setPendingRemoval(null);
            }}>
              Remove account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
