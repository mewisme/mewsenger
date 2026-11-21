export type LocalView = "titlebar" | "status" | "settings" | "tabmenu";

export function resolveLocalView(search: string, fallbackLabel: string | null): LocalView {
  const params = new URLSearchParams(search);
  const selected = params.get("view");
  if (
    selected === "titlebar" || selected === "status" ||
    selected === "settings" || selected === "tabmenu"
  ) {
    return selected;
  }
  if (params.get("preview") === "titlebar") return "titlebar";
  if (fallbackLabel === "settings" || fallbackLabel === "tabmenu") return fallbackLabel;
  if (fallbackLabel?.startsWith("titlebar")) return "titlebar";
  return "status";
}

export interface AccountRef {
  id: string;
  name: string;
}

const ACCOUNT_ID = /^a[0-9]{1,3}$/;

function safeDecode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * Accounts a local view displays, from `?accounts=a1:Name,a2:Other` where each
 * name is percent-escaped. Malformed entries are dropped; with none left the
 * single default account is assumed.
 */
export function parseAccounts(search: string): AccountRef[] {
  const raw = new URLSearchParams(search).get("accounts") ?? "";
  const accounts: AccountRef[] = [];
  for (const entry of raw.split(",")) {
    const [id, encoded] = [entry.split(":")[0], entry.slice(entry.indexOf(":") + 1)];
    const name = entry.includes(":") ? safeDecode(encoded) : id;
    if (!ACCOUNT_ID.test(id) || name === null || accounts.some((a) => a.id === id)) continue;
    accounts.push({ id, name: name.trim() === "" ? id : name });
  }
  return accounts.length > 0 ? accounts : [{ id: "a1", name: "Account 1" }];
}

export interface TabsView {
  /** Every account, open or not. */
  accounts: AccountRef[];
  /** Ids with a tab, in tab order. */
  open: string[];
  active: string;
}

/**
 * Tabs of the title bar (`?accounts=…&open=a1,a2&active=a2`). Unknown ids in
 * `open` are dropped; with none left the first account is the only tab.
 */
export function parseTabs(search: string): TabsView {
  const params = new URLSearchParams(search);
  const accounts = parseAccounts(search);
  const open: string[] = [];
  for (const id of (params.get("open") ?? "").split(",")) {
    if (accounts.some((a) => a.id === id) && !open.includes(id)) open.push(id);
  }
  if (open.length === 0) open.push(accounts[0].id);
  const active = params.get("active") ?? "";
  return { accounts, open, active: open.includes(active) ? active : open[0] };
}

export interface TabMenuView {
  /** Accounts without a tab; may be empty. */
  accounts: AccountRef[];
  /** Number the next new account is named after. */
  next: number;
}

/** Content of the new-tab dropdown (`?accounts=…&next=3`). */
export function parseTabMenu(search: string): TabMenuView {
  const params = new URLSearchParams(search);
  const raw = params.get("accounts") ?? "";
  const accounts = raw === "" ? [] : parseAccounts(search).filter((account) =>
    raw.split(",").some((entry) => entry.split(":")[0] === account.id));
  const next = Number(params.get("next"));
  return { accounts, next: Number.isInteger(next) && next > 0 ? next : 2 };
}

/** True when settings are drawn over the main window (`?overlay=1`). */
export function parseOverlay(search: string): boolean {
  return new URLSearchParams(search).get("overlay") === "1";
}
