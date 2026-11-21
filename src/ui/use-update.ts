import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UpdateState } from "@/ui/status-types";

const isState = (value: unknown): value is UpdateState =>
  typeof value === "object" && value !== null && typeof (value as { state?: unknown }).state === "string";

export function useUpdate(enabled = true) {
  const [update, setUpdateRaw] = useState<UpdateState>({ state: "unconfigured" });
  // Ignore malformed payloads rather than rendering an undefined state.
  const setUpdate = useCallback((value: unknown) => {
    if (isState(value)) setUpdateRaw(value);
  }, []);

  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let active = true;
    let received = false;
    let detach: (() => void) | undefined;
    void listen<UpdateState>("update-status", (event) => {
      received = true;
      if (active) setUpdate(event.payload);
    }).then((unlisten) => {
      if (!active) {
        unlisten();
        return;
      }
      detach = unlisten;
      return invoke<UpdateState>("get_update_state").then((value) => {
        if (active && !received) setUpdate(value);
      });
    }).catch(() => { /* Stay on the safe "not configured" display. */ });
    return () => {
      active = false;
      detach?.();
    };
  }, [enabled, setUpdate]);

  const run = useCallback((command: "check_update" | "install_update") => {
    invoke<UpdateState>(command).then(setUpdate).catch(() => {
      setUpdate({ state: "error", message: "Update request failed" });
    });
  }, [setUpdate]);

  const act = useCallback(() => {
    run(update.state === "available" ? "install_update" : "check_update");
  }, [run, update.state]);

  return { update, act };
}
