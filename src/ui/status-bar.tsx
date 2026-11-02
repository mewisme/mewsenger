import { CircleDot, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type ConnectionState = "connected" | "offline" | "unknown";

export interface StatusBarProps {
  version: string;
  connection: ConnectionState;
  unreadCount: number | null;
  onCredits: () => void;
}

const labels: Record<ConnectionState, string> = {
  connected: "Connected",
  offline: "Offline",
  unknown: "Status unavailable",
};

export function StatusBar({ version, connection, unreadCount, onCredits }: StatusBarProps) {
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
          <Separator orientation="vertical" className="h-3" />
          <span aria-label="Application version" className="tabular-nums">{version}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" type="button" onClick={onCredits} aria-label="Credits">
                <Info aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Credits</TooltipContent>
          </Tooltip>
        </div>
      </footer>
    </TooltipProvider>
  );
}
