import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { TitleBar } from "@/ui/title-bar";
import { parseTabMenu, parseTabs, resolveLocalView } from "@/ui/local-view";
import { Settings } from "@/ui/settings";
import { TabMenu } from "@/ui/tab-menu";

export function DesktopApp() {
  const [version, setVersion] = useState("");
  const search = typeof window !== "undefined" ? window.location.search : "";
  const localView = resolveLocalView(
    search,
    isTauri() ? getCurrentWebview().label : null,
  );
  const settingsView = localView === "settings";

  useEffect(() => {
    if (!isTauri() || !settingsView) return;
    let active = true;
    void getVersion()
      .then((value) => { if (active) setVersion(value); })
      .catch(() => { if (active) setVersion(""); });
    return () => { active = false; };
  }, [settingsView]);

  if (localView === "tabmenu") return <TabMenu view={parseTabMenu(search)} />;

  if (settingsView) return <Settings version={version} />;

  return <TitleBar tabs={parseTabs(search)} />;
}
