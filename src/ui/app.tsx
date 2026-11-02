import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBar } from "@/ui/status-bar";

export function DesktopApp() {
  const [version, setVersion] = useState("Version unavailable");
  const [creditsOpen, setCreditsOpen] = useState(false);
  const creditsView = isTauri() && getCurrentWebview().label === "credits";
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [connection, setConnection] = useState<"offline" | "unknown">(
    () => typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unknown",
  );

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void getVersion()
      .then((value) => { if (active) setVersion(value); })
      .catch(() => { if (active) setVersion("Version unavailable"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isTauri() || creditsView) return;
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
  }, [creditsView]);

  useEffect(() => {
    const offline = () => setConnection("offline");
    // A working network connection does not prove a Messenger session is connected.
    const online = () => setConnection("unknown");
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  if (creditsView) {
    return (
      <main className="flex h-screen flex-col justify-center gap-3 overflow-auto bg-background px-6 py-5 text-foreground">
        <h1 className="text-xl font-semibold">Messenger desktop</h1>
        <p className="text-sm text-muted-foreground">
          A desktop client built with Tauri, React, and shadcn/ui.
        </p>
        <p className="text-sm tabular-nums">{version}</p>
        <p className="text-xs text-muted-foreground">Made by Mew</p>
      </main>
    );
  }

  function showCredits() {
    if (isTauri()) {
      void invoke("show_credits").catch(() => setCreditsOpen(true));
      return;
    }
    setCreditsOpen(true);
  }

  return (
    <main className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1" aria-hidden="true" />
      <StatusBar
        version={version}
        connection={connection}
        unreadCount={unreadCount}
        onCredits={showCredits}
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
