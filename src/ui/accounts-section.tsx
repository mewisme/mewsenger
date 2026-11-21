import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export interface AccountInfo {
  id: string;
  name: string;
}

export type LayoutMode = "windows" | "split";

export interface AccountsConfig {
  layout: LayoutMode;
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

  function commitRename(account: AccountInfo) {
    const name = draftOf(account).trim();
    setDrafts(({ [account.id]: _discarded, ...rest }) => rest);
    if (name === "" || name === account.name) return;
    run("rename_account", { id: account.id, name }, "Could not rename account");
  }

  return (
    <section aria-labelledby="settings-accounts">
      <h2 id="settings-accounts" className="text-sm font-semibold">Accounts</h2>
      <ul className="mt-1 flex flex-col gap-1">
        {config.accounts.map((account) => (
          <li key={account.id} className="flex items-center gap-2 py-1">
            <input
              type="text"
              aria-label={`Name of ${account.name}`}
              value={draftOf(account)}
              maxLength={24}
              onChange={(event) => setDrafts({ ...drafts, [account.id]: event.target.value })}
              onBlur={() => commitRename(account)}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
            />
            <Button type="button" variant="secondary" size="sm"
              aria-label={`Open ${account.name}`}
              onClick={() => {
                setMessage(null);
                invoke("open_account", { id: account.id })
                  .catch(() => setMessage("Could not open account"));
              }}>
              Open
            </Button>
            <Button type="button" variant="destructive" size="sm"
              aria-label={`Remove ${account.name}`}
              disabled={account.id === FIRST_ACCOUNT}
              onClick={() => setPendingRemoval(account)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-4 py-2">
        <p className="text-xs text-muted-foreground">
          {count >= MAX_ACCOUNTS ? `Up to ${MAX_ACCOUNTS} accounts.` : "Each account keeps its own login."}
        </p>
        <Button type="button" variant="secondary" size="sm"
          disabled={count >= MAX_ACCOUNTS}
          onClick={() => run("add_account", { name: `Account ${config.next_id}` }, "Could not add account")}>
          Add account
        </Button>
      </div>
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="min-w-0">
          <span id="layout-label" className="text-sm font-medium">Layout</span>
          {!splitAllowed && (
            <p className="text-xs text-muted-foreground">Split supports up to 2 accounts</p>
          )}
        </div>
        <div role="group" aria-labelledby="layout-label" className="flex gap-1">
          <Button type="button" size="sm"
            variant={config.layout === "windows" ? "default" : "secondary"}
            aria-pressed={config.layout === "windows"}
            onClick={() => run("set_layout", { layout: "windows" }, "Could not change layout")}>
            Separate windows
          </Button>
          <Button type="button" size="sm"
            variant={config.layout === "split" ? "default" : "secondary"}
            aria-pressed={config.layout === "split"}
            disabled={!splitAllowed}
            title={splitAllowed ? undefined : "Split supports up to 2 accounts"}
            onClick={() => run("set_layout", { layout: "split" }, "Could not change layout")}>
            Split panes
          </Button>
        </div>
      </div>
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
    </section>
  );
}
