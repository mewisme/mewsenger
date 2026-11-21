import { CircleDot, Download, RefreshCcw, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  downloadTooltip, updateActionable, updateTooltip,
  type DownloadStatus, type UpdateState,
} from "@/ui/status-types";

export type ConnectionState = "connected" | "offline" | "signed_out" | "unknown";

export interface StatusAccount {
  id: string;
  name: string;
  connection: ConnectionState;
  unreadCount: number | null;
}

export interface StatusBarProps {
  accounts: StatusAccount[];
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

/** With several accounts every label names its account so each stays distinguishable. */
function ConnectionLabel({ account, named }: { account: StatusAccount; named: boolean }) {
  return (
    <span
      role="status"
      aria-label={named ? `Connection status: ${account.name}` : "Connection status"}
      aria-live="polite"
      className="inline-flex min-w-0 items-center gap-1.5 truncate"
    >
      <CircleDot aria-hidden="true" className="size-3 shrink-0" />
      {named && <span className="truncate font-medium text-foreground">{account.name}</span>}
      <span className="truncate">{labels[account.connection]}</span>
    </span>
  );
}

function UnreadBadge({ account, named }: { account: StatusAccount; named: boolean }) {
  return (
    <output aria-label={named ? `Unread conversations: ${account.name}` : "Unread conversations"}>
      <Badge variant="secondary">
        {account.unreadCount === null ? "–" : Math.max(0, account.unreadCount)}
      </Badge>
    </output>
  );
}

export function StatusBar({
  accounts, onSettings, update = unconfigured, onUpdate, download, onRevealDownload,
}: StatusBarProps) {
  const updatesOff = update.state === "unconfigured";
  const controls = (
    <>
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
    </>
  );
  const single = accounts.length === 1 ? accounts[0] : null;
  return (
    <TooltipProvider>
      <footer
        aria-label="Application status"
        className="flex h-9 w-full shrink-0 select-none items-center justify-between gap-3 border-t border-border bg-background px-3 text-xs text-muted-foreground"
      >
        {single ? (
          <>
            <ConnectionLabel account={single} named={false} />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <UnreadBadge account={single} named={false} />
              {controls}
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-4">
              {accounts.map((account) => (
                <span key={account.id} className="inline-flex min-w-0 items-center gap-1.5">
                  <ConnectionLabel account={account} named />
                  <UnreadBadge account={account} named />
                </span>
              ))}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">{controls}</div>
          </>
        )}
      </footer>
    </TooltipProvider>
  );
}
