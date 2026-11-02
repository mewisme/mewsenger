import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBar } from "@/ui/status-bar";

export function DesktopApp() {
  const [version, setVersion] = useState("Version unavailable");
  const [creditsOpen, setCreditsOpen] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void getVersion()
      .then((value) => { if (active) setVersion(value); })
      .catch(() => { if (active) setVersion("Version unavailable"); });
    return () => { active = false; };
  }, []);

  return (
    <main className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1" aria-hidden="true" />
      <StatusBar
        version={version}
        connection="unknown"
        unreadCount={null}
        onCredits={() => setCreditsOpen(true)}
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
