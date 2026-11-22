import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/i18n";
import { AccountAvatar, accountLabel } from "@/ui/account-avatar";
import { SwitchRow } from "@/ui/setting-row";

export interface AccountInfo {
  id: string;
  /** Internal fallback name; never shown as the label. */
  name: string;
  /** Messenger's name for the user, once signed in. */
  display_name?: string;
  /** Their picture as a data URL, once signed in. */
  picture?: string;
}

export type SettingsPlacement = "window" | "overlay";

export interface AccountsConfig {
  settings: SettingsPlacement;
  active: string;
  open: string[];
  next_id: number;
  accounts: AccountInfo[];
}

const FIRST_ACCOUNT = "a1";

function isConfig(value: unknown): value is AccountsConfig {
  return typeof value === "object" && value !== null &&
    Array.isArray((value as AccountsConfig).accounts);
}

const asRef = (account: AccountInfo) =>
  ({ id: account.id, name: account.display_name?.trim() ?? "", picture: account.picture });

export function AccountsSection() {
  const t = useT();
  const [config, setConfig] = useState<AccountsConfig | null>(null);
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
        else setMessage(t("accounts.loadFailed"));
      })
      .catch(() => { if (active) setMessage(t("accounts.loadFailed")); });
    return () => {
      active = false;
      detach?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function run(command: string, args: Record<string, unknown>, failure: string) {
    setMessage(null);
    invoke<AccountsConfig>(command, args)
      .then((value) => (isConfig(value) ? setConfig(value) : setMessage(failure)))
      .catch(() => setMessage(failure));
  }

  const removalLabel = pendingRemoval ? accountLabel(asRef(pendingRemoval), t) : "";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("accounts.title")}</CardTitle>
          <CardDescription>{t("accounts.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {config && (
            <ul className="flex flex-col gap-2">
              {config.accounts.map((account) => {
                const label = accountLabel(asRef(account), t);
                const isOpen = config.open.includes(account.id);
                return (
                  <li key={account.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2">
                    <AccountAvatar account={asRef(account)} className="size-8" />
                    <span className={`min-w-0 flex-1 truncate text-sm font-medium ${asRef(account).name ? "" : "text-muted-foreground"}`}>
                      {label}
                    </span>
                    {account.id === config.active
                      ? <Badge variant="secondary">{t("accounts.showing")}</Badge>
                      : isOpen && <Badge variant="outline">{t("accounts.open")}</Badge>}
                    <Button type="button" variant="secondary" size="sm"
                      aria-label={t("accounts.openLabel", { name: label })}
                      disabled={account.id === config.active}
                      onClick={() => {
                        setMessage(null);
                        invoke("open_account", { id: account.id })
                          .catch(() => setMessage(t("accounts.openFailed")));
                      }}>
                      {isOpen ? t("accounts.switch") : t("accounts.openTab")}
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm"
                      aria-label={t("accounts.removeLabel", { name: label })}
                      title={account.id === FIRST_ACCOUNT ? t("accounts.firstCannotRemove") : t("accounts.remove")}
                      disabled={account.id === FIRST_ACCOUNT}
                      className="text-destructive hover:text-destructive"
                      onClick={() => setPendingRemoval(account)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <Button type="button" variant="outline" size="sm" className="border-dashed"
            disabled={config === null}
            onClick={() => config && run("add_account", { name: `Account ${config.next_id}` }, t("accounts.addFailed"))}>
            <Plus aria-hidden="true" />
            {t("accounts.add")}
          </Button>
          <Separator />
          <SwitchRow id="pref-overlay" label={t("accounts.overlay")} hint={t("accounts.overlayHint")}
            checked={config?.settings === "overlay"} disabled={config === null}
            onChange={(value) => run("set_settings_placement",
              { placement: value ? "overlay" : "window" }, t("accounts.placementFailed"))} />
          {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
        </CardContent>
      </Card>
      <Dialog open={pendingRemoval !== null}
        onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("accounts.removeTitle", { name: removalLabel })}</DialogTitle>
            <DialogDescription>{t("accounts.removeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPendingRemoval(null)}>
              {t("accounts.cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => {
              if (pendingRemoval) {
                run("remove_account", { id: pendingRemoval.id }, t("accounts.removeFailed"));
              }
              setPendingRemoval(null);
            }}>
              {t("accounts.removeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
