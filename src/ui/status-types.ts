import type { Translate } from "@/i18n";

export type UpdateState =
  | { state: "unconfigured" }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading" }
  | { state: "ready" }
  | { state: "up_to_date" }
  | { state: "error"; message: string };

export type DownloadStatus =
  | { state: "downloading"; file_name: string }
  | { state: "done"; file_name: string }
  | { state: "failed"; file_name: string };

export function updateTooltip(update: UpdateState, t: Translate): string {
  switch (update.state) {
    case "unconfigured": return t("update.unconfigured");
    case "idle": return t("update.idle");
    case "checking": return t("update.checking");
    case "available": return t("update.available", { version: update.version });
    case "downloading": return t("update.downloading");
    case "ready": return t("update.ready");
    case "up_to_date": return t("update.upToDate");
    case "error": return update.message;
  }
}

/** States in which a check or install request may be sent. */
export function updateActionable(update: UpdateState): boolean {
  return update.state === "idle" || update.state === "available" ||
    update.state === "up_to_date" || update.state === "error";
}

/** The title bar offers an update only once there is one to install. */
export function updateOffered(update: UpdateState): boolean {
  return update.state === "available" || update.state === "downloading" || update.state === "ready";
}

export function downloadTooltip(download: DownloadStatus, t: Translate): string {
  switch (download.state) {
    case "downloading": return t("download.downloading", { file: download.file_name });
    case "done": return t("download.done", { file: download.file_name });
    case "failed": return t("download.failed", { file: download.file_name });
  }
}
