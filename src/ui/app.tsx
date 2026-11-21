import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBar } from "@/ui/status-bar";
import { TitleBar } from "@/ui/title-bar";
import { resolveLocalView } from "@/ui/local-view";
import { Credits } from "@/ui/credits";
import { Settings } from "@/ui/settings";

export function DesktopApp() {
  const [version, setVersion] = useState("Version unavailable");
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [notificationTestStatus, setNotificationTestStatus] = useState<string | null>(null);
  const localView = resolveLocalView(
    typeof window !== "undefined" ? window.location.search : "",
    isTauri() ? getCurrentWebview().label : null,
  );
  const creditsView = localView === "credits";
  const titlebarView = localView === "titlebar";
  const settingsView = localView === "settings";
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [connection, setConnection] = useState<"offline" | "unknown">(
    () => typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unknown",
  );

  useEffect(() => {
    if (!isTauri() || titlebarView) return;
    let active = true;
    void getVersion()
      .then((value) => { if (active) setVersion(value); })
      .catch(() => { if (active) setVersion("Version unavailable"); });
    return () => { active = false; };
  }, [titlebarView]);

  useEffect(() => {
    if (!isTauri() || creditsView || titlebarView || settingsView) return;
    let active = true;
    let eventReceived = false;
    let detach: (() => void) | undefined;
    const accept = (count: number | null) => {
      if (!active) return;
      // Only display a count that the native bridge has confirmed.
      setUnreadCount(typeof count === "number" && Number.isSafeInteger(count) &&
        count >= 0 ? count : null);
    };
    void listen<{ unread_count: number | null }>("desktop-status", (event) => {
      eventReceived = true;
      accept(event.payload.unread_count);
    }).then((unlisten) => {
      if (!active) {
        unlisten();
        return;
      }
      detach = unlisten;
      return invoke<{ unread_count: number | null }>("current_status")
        .then((snapshot) => {
          if (!eventReceived) accept(snapshot.unread_count);
        });
    }).catch(() => { /* Keep the unverified value unknown. */ });
    return () => {
      active = false;
      detach?.();
    };
  }, [creditsView, titlebarView, settingsView]);

  useEffect(() => {
    if (titlebarView || creditsView || settingsView) return;
    const offline = () => setConnection("offline");
    // A working network connection does not prove a Messenger session is connected.
    const online = () => setConnection("unknown");
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [titlebarView, creditsView, settingsView]);

  if (titlebarView) return <TitleBar />;

  if (settingsView) return <Settings version={version} />;

  if (creditsView) {
    return <Credits version={version} />;
  }

  function showCredits() {
    if (isTauri()) {
      void invoke("show_credits").catch(() => setCreditsOpen(true));
      return;
    }
    setCreditsOpen(true);
  }

  function showSettings() {
    void invoke("show_settings").catch(() => { /* The tray menu offers the same window. */ });
  }

  function testDesktopNotification() {
    if (!isTauri()) return;
    setNotificationTestStatus("Sending notification request…");
    void invoke("test_notification")
      .then(() => setNotificationTestStatus("Request sent; check Windows notifications"))
      .catch(() => setNotificationTestStatus("Notification request failed"));
  }

  return (
    <main className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1" aria-hidden="true" />
      <StatusBar
        version={version}
        connection={connection}
        unreadCount={unreadCount}
        onCredits={showCredits}
        onSettings={isTauri() ? showSettings : undefined}
        onTestNotification={isTauri() ? testDesktopNotification : undefined}
        notificationTestStatus={notificationTestStatus}
      />
      <Dialog open={creditsOpen} onOpenChange={setCreditsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Messenger desktop</DialogTitle>
            <DialogDescription>
              A desktop client built with Tauri, React, and shadcn/ui.
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Made by Mew</p>
        </DialogContent>
      </Dialog>
    </main>
  );
}
