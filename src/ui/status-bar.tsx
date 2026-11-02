export type ConnectionState = "connected" | "offline" | "unknown";

export interface StatusBarProps {
  version: string;
  connection: ConnectionState;
  unreadCount: number;
  onCredits: () => void;
}

const labels: Record<ConnectionState, string> = {
  connected: "Connected",
  offline: "Offline",
  unknown: "Status unavailable",
};

export function StatusBar({ version, connection, unreadCount, onCredits }: StatusBarProps) {
  return (
    <footer aria-label="Application status">
      <span role="status" aria-label="Connection status" aria-live="polite">{labels[connection]}</span>
      <output aria-label="Unread conversations">{Math.max(0, unreadCount)}</output>
      <span aria-label="Application version">{version}</span>
      <button type="button" onClick={onCredits}>Credits</button>
    </footer>
  );
}
