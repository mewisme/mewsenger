export type LocalView = "titlebar" | "status" | "settings" | "split";

export function resolveLocalView(search: string, fallbackLabel: string | null): LocalView {
  const params = new URLSearchParams(search);
  const selected = params.get("view");
  if (
    selected === "titlebar" || selected === "status" ||
    selected === "settings" || selected === "split"
  ) {
    return selected;
  }
  if (params.get("preview") === "titlebar") return "titlebar";
  if (fallbackLabel === "settings" || fallbackLabel === "split") return fallbackLabel;
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

/** Account ids and divider position for the split view (`?accounts=a1,a2&ratio=0.5`). */
export function parseSplit(search: string): { ids: string[]; ratio: number } {
  const params = new URLSearchParams(search);
  const ids = parseAccounts(`?accounts=${params.get("accounts") ?? ""}`).map((a) => a.id);
  const ratio = Number(params.get("ratio"));
  return {
    ids,
    ratio: Number.isFinite(ratio) && ratio > 0 ? Math.min(0.8, Math.max(0.2, ratio)) : 0.5,
  };
}

export interface TabsView {
  accounts: AccountRef[];
  active: string;
}

/**
 * Account tabs of the single-window title bar (`?accounts=…&active=a2`); null
 * unless at least two accounts are listed.
 */
export function parseTabs(search: string): TabsView | null {
  const params = new URLSearchParams(search);
  if (!params.get("accounts")) return null;
  const accounts = parseAccounts(search);
  if (accounts.length < 2) return null;
  const active = params.get("active") ?? "";
  return { accounts, active: accounts.some((a) => a.id === active) ? active : accounts[0].id };
}

/** True when settings are drawn over the main window (`?overlay=1`). */
export function parseOverlay(search: string): boolean {
  return new URLSearchParams(search).get("overlay") === "1";
}
