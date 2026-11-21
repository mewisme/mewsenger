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

export function updateTooltip(update: UpdateState): string {
  switch (update.state) {
    case "unconfigured": return "Updates are not configured";
    case "idle": return "Check for updates";
    case "checking": return "Checking for updates";
    case "available": return `Install version ${update.version}`;
    case "downloading": return "Downloading update";
    case "ready": return "Restarting to finish the update";
    case "up_to_date": return "Up to date. Check again";
    case "error": return update.message;
  }
}

export function updateActionable(update: UpdateState): boolean {
  return update.state === "idle" || update.state === "available" ||
    update.state === "up_to_date" || update.state === "error";
}

export function downloadTooltip(download: DownloadStatus): string {
  switch (download.state) {
    case "downloading": return `Downloading ${download.file_name}`;
    case "done": return `Downloaded ${download.file_name}. Show in folder`;
    case "failed": return `Download failed: ${download.file_name}`;
  }
}
