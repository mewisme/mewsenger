import { CircleDot, Download, RefreshCcw, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  downloadTooltip, updateActionable, updateTooltip,
  type DownloadStatus, type UpdateState,
} from "@/ui/status-types";

export type ConnectionState = "connected" | "offline" | "signed_out" | "unknown";

export interface StatusBarProps {
  connection: ConnectionState;
  unreadCount: number | null;
  onSettings?: () => void;
  update?: UpdateState;
  onUpdate?: () => void;
  download?: DownloadStatus | null;
  onRevealDownload?: () => void;
}

const labels: Record<ConnectionState, string> = {
  connected: "Connected",
  offline: "Offline",
  signed_out: "Signed out",
  unknown: "Status unavailable",
};

const unconfigured: UpdateState = { state: "unconfigured" };

export function StatusBar({
  connection, unreadCount, onSettings, update = unconfigured, onUpdate, download, onRevealDownload,
}: StatusBarProps) {
  const updatesOff = update.state === "unconfigured";
  return (
    <TooltipProvider>
      <footer
        aria-label="Application status"
        className="flex h-9 w-full shrink-0 select-none items-center justify-between gap-3 border-t border-border bg-background px-3 text-xs text-muted-foreground"
      >
        <span role="status" aria-label="Connection status" aria-live="polite" className="inline-flex min-w-0 items-center gap-1.5 truncate">
          <CircleDot aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{labels[connection]}</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <output aria-label="Unread conversations">
            <Badge variant="secondary">{unreadCount === null ? "–" : Math.max(0, unreadCount)}</Badge>
          </output>
          {download && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" type="button"
                  disabled={download.state !== "done"}
                  onClick={download.state === "done" ? onRevealDownload : undefined}
                  aria-label="Download status">
                  <Download aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6} className="max-w-none whitespace-nowrap py-1">{downloadTooltip(download)}</TooltipContent>
            </Tooltip>
          )}
          {!updatesOff && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" type="button"
                  disabled={!onUpdate || !updateActionable(update)}
                  onClick={onUpdate}
                  aria-label="Updates">
                  <RefreshCcw aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6} className="max-w-none whitespace-nowrap py-1">{updateTooltip(update)}</TooltipContent>
            </Tooltip>
          )}
          {onSettings && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" type="button" onClick={onSettings} aria-label="Settings">
                  <Settings aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6} className="max-w-none whitespace-nowrap py-1">Settings</TooltipContent>
            </Tooltip>
          )}
        </div>
      </footer>
    </TooltipProvider>
  );
}
