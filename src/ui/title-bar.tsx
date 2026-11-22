import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { Minus, Square, Copy, X } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import appIcon from "../../src-tauri/icons/32x32.png";
import { AccountTabs } from "@/ui/account-tabs";
import type { TabsView } from "@/ui/local-view";
import { TitleActions } from "@/ui/title-actions";

export function TitleBar({ tabs = null }: { tabs?: TabsView | null }) {
  const t = useT();
  const window = useMemo(() => isTauri() ? getCurrentWindow() : null, []);
  const native = window !== null;
  const [maximized, setMaximized] = useState(false);
  const [controlError, setControlError] = useState("");

  useEffect(() => {
    const { body, documentElement } = document;
    const previous = [body.style.overflow, documentElement.style.overflow];
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous[0];
      documentElement.style.overflow = previous[1];
    };
  }, []);

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
      .catch(() => setControlError(t("titlebar.controlUnavailable")));
  };

  return (
    <header aria-label={t("titlebar.label")}
      className={`flex h-10 w-full select-none items-end overflow-hidden border-b border-border text-foreground ${tabs ? "bg-muted/50" : "bg-background"}`}>
      <div aria-label={t("titlebar.drag")}
        className={`flex h-full cursor-default items-center gap-2 ${tabs ? "shrink-0 pl-3 pr-1" : "min-w-0 flex-1 px-3"}`}
        onMouseDown={drag}
        onDoubleClick={toggleMaximize}>
        <img src={appIcon} alt="" aria-hidden="true" className="size-4 shrink-0" />
        {!tabs && <span className="truncate text-xs font-semibold">Mewsenger</span>}
      </div>
      {tabs && (
        <>
          <AccountTabs initial={tabs} />
          <div aria-hidden="true" className="h-full min-w-4 flex-1 cursor-default"
            onMouseDown={drag}
            onDoubleClick={toggleMaximize} />
        </>
      )}
      <TitleActions />
      <nav aria-label={t("titlebar.controls")} className="flex h-full shrink-0 items-stretch">
        <Button type="button" size="icon" variant="ghost" disabled={!native}
          aria-label={t("titlebar.minimizeWindow")} title={t("titlebar.minimize")}
          className="h-10 w-11 rounded-none hover:bg-accent"
          onClick={() => void window?.minimize().catch(() => {})}>
          <Minus aria-hidden="true" className="size-4" />
        </Button>
        <Button type="button" size="icon" variant="ghost" disabled={!native}
          aria-label={maximized ? t("titlebar.restoreWindow") : t("titlebar.maximizeWindow")}
          title={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
          className="h-10 w-11 rounded-none hover:bg-accent"
          onClick={toggleMaximize}>
          {maximized ? <Copy aria-hidden="true" className="size-3.5 -scale-x-100" /> : <Square aria-hidden="true" className="size-3.5" />}
        </Button>
        <Button type="button" size="icon" variant="ghost" disabled={!native}
          aria-label={t("titlebar.closeWindow")} title={t("titlebar.close")}
          className="h-10 w-11 rounded-none hover:bg-red-600 hover:text-white dark:hover:bg-red-600"
          onClick={() => void window?.close().catch(() => {})}>
          <X aria-hidden="true" className="size-4" />
        </Button>
      </nav>
      {controlError && <span role="alert" className="sr-only">{controlError}</span>}
    </header>
  );
}
