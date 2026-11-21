import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { StatusBar } from "@/ui/status-bar";
import { TitleBar } from "@/ui/title-bar";
import { parseOverlay, parseSplit, parseTabs, resolveLocalView } from "@/ui/local-view";
import { Settings } from "@/ui/settings";
import { SplitView } from "@/ui/split";
import type { DownloadStatus } from "@/ui/status-types";
import { useUpdate } from "@/ui/use-update";

export function DesktopApp() {
  const [version, setVersion] = useState("Version unavailable");
  const search = typeof window !== "undefined" ? window.location.search : "";
  const localView = resolveLocalView(
    search,
    isTauri() ? getCurrentWebview().label : null,
  );
  const titlebarView = localView === "titlebar";
  const settingsView = localView === "settings";
  const splitView = localView === "split";
  const statusView = localView === "status";
  const [download, setDownload] = useState<DownloadStatus | null>(null);
  const { update, act } = useUpdate(statusView);

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

  if (titlebarView) return <TitleBar tabs={parseTabs(search)} />;

  if (settingsView) return <Settings version={version} overlay={parseOverlay(search)} />;

  if (splitView) {
    const { ids, ratio } = parseSplit(search);
    return <SplitView ids={ids} ratio={ratio} />;
  }

  function showSettings() {
    void invoke("show_settings").catch(() => { /* The tray menu offers the same window. */ });
  }

  return (
    <main className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1" aria-hidden="true" />
      <StatusBar
        onSettings={isTauri() ? showSettings : undefined}
        update={update}
        onUpdate={isTauri() ? act : undefined}
        download={download}
        onRevealDownload={() => { void invoke("reveal_last_download").catch(() => {}); }}
      />
    </main>
  );
}
