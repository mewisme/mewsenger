import { useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import appIcon from "../../src-tauri/icons/128x128.png";

export function Credits({ version }: { version: string }) {
  const window = useMemo(() => isTauri() ? getCurrentWindow() : null, []);
  const [closeError, setCloseError] = useState(false);

  const close = () => {
    if (!window) return;
    setCloseError(false);
    void window.close().catch(() => setCloseError(true));
  };

  return (
    <main className="flex h-screen w-full flex-col justify-between gap-3 overflow-auto bg-background px-6 py-5 text-foreground">
      <div className="flex items-center gap-4">
        <img src={appIcon} alt="Messenger icon" className="size-14 shrink-0" />
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-semibold">Messenger</h1>
          <p className="text-sm text-muted-foreground">Version {version}</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Desktop client powered by Tauri, React and shadcn/ui.
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Made by Mew</span>
        <Button type="button" variant="secondary" onClick={close} disabled={!window}>
          Close
        </Button>
      </div>
      {closeError && <p role="alert" className="text-xs text-destructive">Could not close this window.</p>}
    </main>
  );
}
