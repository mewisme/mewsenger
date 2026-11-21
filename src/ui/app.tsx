import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { StatusBar, type ConnectionState } from "@/ui/status-bar";
import { TitleBar } from "@/ui/title-bar";
import { parseAccounts, parseSplit, resolveLocalView } from "@/ui/local-view";
import { Settings } from "@/ui/settings";
import { SplitView } from "@/ui/split";
import type { DownloadStatus } from "@/ui/status-types";
import { useUpdate } from "@/ui/use-update";

type NativeStatus = {
  account: string;
  unread_count: number | null;
  session?: boolean | null;
};

type AccountStatus = { unread: number | null; session: boolean | null };

const unknownStatus: AccountStatus = { unread: null, session: null };

export function DesktopApp() {
  const [version, setVersion] = useState("Version unavailable");
  const search = typeof window !== "undefined" ? window.location.search : "";
  const localView = resolveLocalView(
    search,
    isTauri() ? getCurrentWebview().label : null,
  );
  const titlebarView = localView === "titlebar";
  const settingsView = localView === "settings";
  const splitView = localView === "split";
  const statusView = localView === "status";
  const shown = useMemo(() => parseAccounts(search), [search]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, AccountStatus>>({});
  const [download, setDownload] = useState<DownloadStatus | null>(null);
  const { update, act } = useUpdate(statusView);
  const [connection, setConnection] = useState<"offline" | "unknown">(
    () => typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unknown",
  );

  useEffect(() => {
    if (!isTauri() || !settingsView) return;
    let active = true;
    void getVersion()
      .then((value) => { if (active) setVersion(value); })
      .catch(() => { if (active) setVersion("Version unavailable"); });
    return () => { active = false; };
  }, [settingsView]);

  useEffect(() => {
    if (!isTauri() || !statusView) return;
    let active = true;
    const received = new Set<string>();
    let detach: (() => void) | undefined;
    const accept = (status: NativeStatus) => {
      if (!active || !shown.some((account) => account.id === status.account)) return;
      const { unread_count: count, session } = status;
      // Only display a count that the native bridge has confirmed.
      setStatuses((previous) => ({
        ...previous,
        [status.account]: {
          unread: typeof count === "number" && Number.isSafeInteger(count) && count >= 0
            ? count : null,
          session: typeof session === "boolean" ? session : null,
        },
      }));
    };
    void listen<NativeStatus>("desktop-status", (event) => {
      received.add(event.payload.account);
      accept(event.payload);
    }).then((unlisten) => {
      if (!active) {
        unlisten();
        return;
      }
      detach = unlisten;
      return invoke<NativeStatus[]>("current_status")
        .then((snapshot) => {
          for (const status of snapshot) {
            if (!received.has(status.account)) accept(status);
          }
        });
    }).catch(() => { /* Keep the unverified value unknown. */ });
    return () => {
      active = false;
      detach?.();
    };
  }, [statusView, shown]);

  useEffect(() => {
    if (!isTauri() || !statusView) return;
    let active = true;
    let detach: (() => void) | undefined;
    void listen<{ accounts: { id: string; name: string }[] }>("accounts-changed", (event) => {
      if (!active) return;
      const next: Record<string, string> = {};
      for (const account of event.payload.accounts) next[account.id] = account.name;
      setNames(next);
    }).then((unlisten) => {
      if (active) detach = unlisten;
      else unlisten();
    }).catch(() => { /* Names stay as they were when the view loaded. */ });
    return () => {
      active = false;
      detach?.();
    };
  }, [statusView]);

  useEffect(() => {
    if (!isTauri() || !statusView) return;
    let active = true;
    let detach: (() => void) | undefined;
    void listen<DownloadStatus>("download-status", (event) => {
      if (active) setDownload(event.payload);
    }).then((unlisten) => {
      if (active) detach = unlisten;
      else unlisten();
    }).catch(() => { /* No download indicator without events. */ });
    return () => {
      active = false;
      detach?.();
    };
  }, [statusView]);

  useEffect(() => {
    if (!statusView) return;
    const offline = () => setConnection("offline");
    // A working network connection does not prove a Messenger session is connected.
    const online = () => setConnection("unknown");
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [statusView]);

  if (titlebarView) return <TitleBar />;

  if (settingsView) return <Settings version={version} />;

  if (splitView) {
    const { ids, ratio } = parseSplit(search);
    return <SplitView ids={ids} ratio={ratio} />;
  }

  function showSettings() {
    void invoke("show_settings").catch(() => { /* The tray menu offers the same window. */ });
  }

  function connectionOf(session: boolean | null): ConnectionState {
    if (connection === "offline") return "offline";
    return session === true ? "connected" : session === false ? "signed_out" : "unknown";
  }

  return (
    <main className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1" aria-hidden="true" />
      <StatusBar
        accounts={shown.map((account) => {
          const status = statuses[account.id] ?? unknownStatus;
          return {
            id: account.id,
            name: names[account.id] ?? account.name,
            connection: connectionOf(status.session),
            unreadCount: status.unread,
          };
        })}
        onSettings={isTauri() ? showSettings : undefined}
        update={update}
        onUpdate={isTauri() ? act : undefined}
        download={download}
        onRevealDownload={() => { void invoke("reveal_last_download").catch(() => {}); }}
      />
    </main>
  );
}
