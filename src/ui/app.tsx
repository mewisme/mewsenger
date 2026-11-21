import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { StatusBar } from "@/ui/status-bar";
import { TitleBar } from "@/ui/title-bar";
import { resolveLocalView } from "@/ui/local-view";
import { Settings } from "@/ui/settings";
import type { DownloadStatus } from "@/ui/status-types";
import { useUpdate } from "@/ui/use-update";

type NativeStatus = { unread_count: number | null; session?: boolean | null };

export function DesktopApp() {
  const [version, setVersion] = useState("Version unavailable");
  const localView = resolveLocalView(
    typeof window !== "undefined" ? window.location.search : "",
    isTauri() ? getCurrentWebview().label : null,
  );
  const titlebarView = localView === "titlebar";
  const settingsView = localView === "settings";
  const statusView = localView === "status";
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [session, setSession] = useState<boolean | null>(null);
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
    let eventReceived = false;
    let detach: (() => void) | undefined;
    const accept = (count: number | null, nextSession?: boolean | null) => {
      if (!active) return;
      // Only display a count that the native bridge has confirmed.
      setUnreadCount(typeof count === "number" && Number.isSafeInteger(count) &&
        count >= 0 ? count : null);
      setSession(typeof nextSession === "boolean" ? nextSession : null);
    };
    void listen<NativeStatus>("desktop-status", (event) => {
      eventReceived = true;
      accept(event.payload.unread_count, event.payload.session);
    }).then((unlisten) => {
      if (!active) {
        unlisten();
        return;
      }
      detach = unlisten;
      return invoke<NativeStatus>("current_status")
        .then((snapshot) => {
          if (!eventReceived) accept(snapshot.unread_count, snapshot.session);
        });
    }).catch(() => { /* Keep the unverified value unknown. */ });
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

  function showSettings() {
    void invoke("show_settings").catch(() => { /* The tray menu offers the same window. */ });
  }

  return (
    <main className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1" aria-hidden="true" />
      <StatusBar
        connection={connection === "offline" ? "offline" : session === true ? "connected" : session === false ? "signed_out" : "unknown"}
        unreadCount={unreadCount}
        onSettings={isTauri() ? showSettings : undefined}
        update={update}
        onUpdate={isTauri() ? act : undefined}
        download={download}
        onRevealDownload={() => { void invoke("reveal_last_download").catch(() => {}); }}
      />
    </main>
  );
}
