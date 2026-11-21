import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountAvatar, accountLabel } from "@/ui/account-avatar";
import type { AccountRef, TabMenuView } from "@/ui/local-view";

interface StoredAccount {
  id: string;
  display_name?: string;
  picture?: string;
}

const ITEM = "h-8 gap-2 px-2 text-xs";

/**
 * Dropdown under the new-tab button: closed accounts, then a fresh sign-in.
 * It lives in a webview of its own, as tall as the menu, because the title bar
 * webview is only 40px high and would clip it; the menu is therefore always
 * open here and closing it closes that webview.
 */
export function TabMenu({ view }: { view: TabMenuView }) {
  // The address carries the names; the pictures come from the app.
  const [accounts, setAccounts] = useState<AccountRef[]>(view.accounts);
  useEffect(() => {
    let active = true;
    void invoke<{ accounts?: StoredAccount[] }>("list_accounts").then((config) => {
      if (!active || !Array.isArray(config?.accounts)) return;
      setAccounts(view.accounts.map((shown) => {
        const stored = config.accounts!.find((account) => account.id === shown.id);
        return stored ? { id: shown.id, name: stored.display_name?.trim() ?? "", picture: stored.picture } : shown;
      }));
    }).catch(() => { /* The names from the address stay. */ });
    return () => { active = false; };
  }, [view.accounts]);

  // Escape, a click outside and losing focus can all end the menu at once.
  const closing = useRef(false);
  const close = () => {
    if (closing.current) return Promise.resolve();
    closing.current = true;
    return invoke("close_tab_menu", {}).catch(() => {});
  };

  useEffect(() => {
    const { body, documentElement } = document;
    const previous = [body.style.background, documentElement.style.background];
    body.style.background = "transparent";
    documentElement.style.background = "transparent";
    const dismiss = () => { void close(); };
    window.addEventListener("blur", dismiss);
    // The menu focuses itself once it is open; the first row is where arrows start.
    const focusFirst = window.setTimeout(() => {
      document.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusFirst);
      body.style.background = previous[0];
      documentElement.style.background = previous[1];
      window.removeEventListener("blur", dismiss);
    };
  }, []);

  function finish(command: string, args: Record<string, unknown>) {
    void invoke(command, args).catch(() => {}).then(close);
  }

  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => { if (!open) void close(); }}>
      <DropdownMenuTrigger aria-hidden="true" tabIndex={-1}
        className="fixed top-0 left-0 h-0 w-full opacity-0" />
      <DropdownMenuContent aria-label="Accounts" loop sideOffset={0} avoidCollisions={false}
        className="w-(--radix-dropdown-menu-trigger-width) animate-none">
        {accounts.map((account) => (
          <DropdownMenuItem key={account.id} className={ITEM}
            onSelect={(event) => { event.preventDefault(); finish("open_account", { id: account.id }); }}>
            <AccountAvatar account={account} />
            <span className="min-w-0 flex-1 truncate">{accountLabel(account)}</span>
          </DropdownMenuItem>
        ))}
        {accounts.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem className={ITEM}
          onSelect={(event) => { event.preventDefault(); finish("add_account", { name: `Account ${view.next}` }); }}>
          <span className="min-w-0 flex-1 truncate">Sign in to a new account</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
