import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Download, RefreshCcw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  downloadTooltip, updateActionable, updateTooltip, type DownloadStatus,
} from "@/ui/status-types";
import { useUpdate } from "@/ui/use-update";

/**
 * Settings, update and download controls on the right of the title bar. The
 * bar is too short for Radix tooltips, so hints use the native `title`.
 */
export function TitleActions() {
  const native = isTauri();
  const { update, act } = useUpdate();
  const [download, setDownload] = useState<DownloadStatus | null>(null);

  useEffect(() => {
    if (!native) return;
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
  }, [native]);

  const showSettings = () => {
    void invoke("show_settings").catch(() => { /* The tray menu offers the same window. */ });
  };
  const reveal = () => {
    void invoke("reveal_last_download").catch(() => {});
  };

  return (
    <div aria-label="Application actions" role="group" className="flex h-full shrink-0 items-center gap-1 px-1">
      {download && (
        <Button variant="ghost" size="icon-sm" type="button"
          disabled={download.state !== "done"}
          onClick={download.state === "done" ? reveal : undefined}
          aria-label="Download status" title={downloadTooltip(download)}>
          <Download aria-hidden="true" />
        </Button>
      )}
      {update.state !== "unconfigured" && (
        <Button variant="ghost" size="icon-sm" type="button"
          disabled={!native || !updateActionable(update)}
          onClick={native ? act : undefined}
          aria-label="Updates" title={updateTooltip(update)}>
          <RefreshCcw aria-hidden="true" />
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" type="button"
        onClick={showSettings} aria-label="Settings" title="Settings">
        <Settings aria-hidden="true" />
      </Button>
    </div>
  );
}
