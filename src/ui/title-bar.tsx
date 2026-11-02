import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { MessageCircle, Minus, Square, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TitleBar() {
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
      className="flex h-10 w-full select-none items-center border-b border-border bg-background text-foreground">
      <div aria-label="Drag Messenger window"
        className="flex h-full min-w-0 flex-1 cursor-default items-center gap-2 px-3"
        onMouseDown={drag}
        onDoubleClick={toggleMaximize}>
        <MessageCircle aria-hidden="true" className="size-4 shrink-0 text-blue-500" />
        <span className="truncate text-xs font-semibold">Messenger</span>
      </div>
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
          className="h-10 w-11 rounded-none hover:bg-red-600 hover:text-white"
          onClick={() => void window?.close().catch(() => {})}>
          <X aria-hidden="true" className="size-4" />
        </Button>
      </nav>
      {controlError && <span role="alert" className="sr-only">{controlError}</span>}
    </header>
  );
}
