import { Download, RefreshCcw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  downloadTooltip, updateActionable, updateTooltip,
  type DownloadStatus, type UpdateState,
} from "@/ui/status-types";

export interface StatusBarProps {
  onSettings?: () => void;
  update?: UpdateState;
  onUpdate?: () => void;
  download?: DownloadStatus | null;
  onRevealDownload?: () => void;
}

const unconfigured: UpdateState = { state: "unconfigured" };

export function StatusBar({
  onSettings, update = unconfigured, onUpdate, download, onRevealDownload,
}: StatusBarProps) {
  const updatesOff = update.state === "unconfigured";
  return (
    <TooltipProvider>
      <footer
        aria-label="Application status"
        className="flex h-9 w-full shrink-0 select-none items-center justify-end gap-2 border-t border-border bg-background px-3 text-xs text-muted-foreground"
      >
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
      </footer>
    </TooltipProvider>
  );
}
