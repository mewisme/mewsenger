import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBar } from "@/ui/status-bar";

export function DesktopApp() {
  const [version, setVersion] = useState("Version unavailable");
  const [creditsOpen, setCreditsOpen] = useState(false);
  const creditsView = isTauri() && getCurrentWebview().label === "credits";

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void getVersion()
      .then((value) => { if (active) setVersion(value); })
      .catch(() => { if (active) setVersion("Version unavailable"); });
    return () => { active = false; };
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
        connection="unknown"
        unreadCount={null}
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
