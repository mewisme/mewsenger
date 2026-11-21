import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { Minus, Square, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import appIcon from "../../src-tauri/icons/32x32.png";
import { AccountTabs } from "@/ui/account-tabs";
import type { TabsView } from "@/ui/local-view";

export function TitleBar({ tabs = null }: { tabs?: TabsView | null }) {
  const window = useMemo(() => isTauri() ? getCurrentWindow() : null, []);
  const native = window !== null;
  const [maximized, setMaximized] = useState(false);
  const [controlError, setControlError] = useState("");

  useEffect(() => {
    if (!window) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const refresh = () => void window.isMaximized()
      .then((value) => { if (active) setMaximized(value); })
      .catch(() => { /* Keep the last known window state. */ });
    refresh();
    void window.onResized(refresh).then((remove) => {
      if (active) unlisten = remove;
      else remove();
    }).catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [window]);

  const drag = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.detail > 1) return;
    void window?.startDragging().catch(() => {});
  };
  const toggleMaximize = () => {
    if (!window) return;
    setControlError("");
    void (maximized ? window.unmaximize() : window.maximize())
      .then(() => window.isMaximized())
      .then(setMaximized)
      .catch(() => setControlError("Window control unavailable"));
  };

  return (
    <header aria-label="Window title bar"
      className={`flex h-10 w-full select-none items-end border-b border-border text-foreground ${tabs ? "bg-muted/50" : "bg-background"}`}>
      <div aria-label="Drag Messenger window"
        className={`flex h-full cursor-default items-center gap-2 ${tabs ? "shrink-0 pl-3 pr-1" : "min-w-0 flex-1 px-3"}`}
        onMouseDown={drag}
        onDoubleClick={toggleMaximize}>
        <img src={appIcon} alt="" aria-hidden="true" className="size-4 shrink-0" />
        {!tabs && <span className="truncate text-xs font-semibold">Messenger</span>}
      </div>
      {tabs && (
        <>
          <AccountTabs initial={tabs} />
          <div aria-hidden="true" className="h-full min-w-4 flex-1 cursor-default"
            onMouseDown={drag}
            onDoubleClick={toggleMaximize} />
        </>
      )}
      <nav aria-label="Window controls" className="flex h-full shrink-0 items-stretch">
        <Button type="button" size="icon" variant="ghost" disabled={!native}
          aria-label="Minimize window" title="Minimize"
          className="h-10 w-11 rounded-none hover:bg-accent"
          onClick={() => void window?.minimize().catch(() => {})}>
          <Minus aria-hidden="true" className="size-4" />
        </Button>
        <Button type="button" size="icon" variant="ghost" disabled={!native}
          aria-label={maximized ? "Restore window" : "Maximize window"}
          title={maximized ? "Restore" : "Maximize"}
          className="h-10 w-11 rounded-none hover:bg-accent"
          onClick={toggleMaximize}>
          {maximized ? <Copy aria-hidden="true" className="size-3.5" /> : <Square aria-hidden="true" className="size-3.5" />}
        </Button>
        <Button type="button" size="icon" variant="ghost" disabled={!native}
          aria-label="Close window" title="Close"
          className="h-10 w-11 rounded-none hover:bg-red-600 hover:text-white dark:hover:bg-red-600"
          onClick={() => void window?.close().catch(() => {})}>
          <X aria-hidden="true" className="size-4" />
        </Button>
      </nav>
      {controlError && <span role="alert" className="sr-only">{controlError}</span>}
    </header>
  );
}
