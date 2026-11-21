import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { updateActionable, updateTooltip } from "@/ui/status-types";
import { useUpdate } from "@/ui/use-update";

interface Preferences {
  notification_preview: boolean;
}

function Row({ id, label, hint, checked, disabled, onChange }: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

export function Settings({ version }: { version: string }) {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { update, act } = useUpdate();
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    let detach: (() => void) | undefined;
    void listen<Preferences>("prefs-changed", (event) => {
      if (active) setPrefs(event.payload);
    }).then((unlisten) => {
      if (active) detach = unlisten;
      else unlisten();
    }).catch(() => { /* The initial read below still works. */ });
    void invoke<Preferences>("get_preferences")
      .then((value) => { if (active) setPrefs(value); })
      .catch(() => { if (active) setError("Could not load settings"); });
    void isEnabled()
      .then((value) => { if (active) setAutostart(value); })
      .catch(() => { if (active) setAutostart(null); });
    return () => {
      active = false;
      detach?.();
    };
  }, []);

  function setPreference(key: keyof Preferences, value: boolean) {
    const previous = prefs;
    setError(null);
    setPrefs((current) => (current ? { ...current, [key]: value } : current));
    invoke<Preferences>("set_preference", { key, value })
      .then(setPrefs)
      .catch(() => {
        setPrefs(previous);
        setError("Could not save");
      });
  }

  function setLaunchAtLogin(value: boolean) {
    const previous = autostart;
    setError(null);
    setAutostart(value);
    (value ? enable() : disable()).catch(() => {
      setAutostart(previous);
      setError("Could not save");
    });
  }

  function copyDiagnostics() {
    setError(null);
    setCopied(false);
    invoke<Record<string, unknown>>("get_diagnostics")
      .then(async (data) => {
        setDiagnostics(data);
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        setCopied(true);
      })
      .catch(() => setError("Could not copy diagnostics"));
  }

  return (
    <main className="flex h-screen w-full flex-col gap-5 overflow-auto bg-background px-6 py-5 text-foreground">
      <section aria-labelledby="settings-notifications">
        <h2 id="settings-notifications" className="text-sm font-semibold">Notifications</h2>
        <Row
          id="pref-preview"
          label="Show message previews in notifications"
          checked={prefs?.notification_preview ?? true}
          disabled={prefs === null}
          onChange={(value) => setPreference("notification_preview", value)}
        />
      </section>
      <section aria-labelledby="settings-startup">
        <h2 id="settings-startup" className="text-sm font-semibold">Startup</h2>
        <Row
          id="pref-autostart"
          label="Launch Messenger when I sign in to Windows"
          hint="Starts minimized to the tray."
          checked={autostart ?? false}
          disabled={autostart === null}
          onChange={setLaunchAtLogin}
        />
      </section>
      <section aria-labelledby="settings-updates">
        <h2 id="settings-updates" className="text-sm font-semibold">Updates</h2>
        <div className="flex items-center justify-between gap-4 py-2">
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {updateTooltip(update)}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={act}
            disabled={!updateActionable(update)}>
            {update.state === "available" ? "Install update" : "Check for updates"}
          </Button>
        </div>
      </section>
      <section aria-labelledby="settings-diagnostics">
        <h2 id="settings-diagnostics" className="text-sm font-semibold">Diagnostics</h2>
        <div className="flex items-center justify-between gap-4 py-2">
          <p className="text-xs text-muted-foreground">
            Versions and status only. No messages, paths or account data.
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={copyDiagnostics}>
            Copy diagnostics
          </Button>
        </div>
        {diagnostics && (
          <pre aria-label="Diagnostics" className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs">
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
        )}
        {copied && <p role="status" className="text-xs text-muted-foreground">Copied</p>}
      </section>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <p className="mt-auto text-xs text-muted-foreground">Version {version}</p>
    </main>
  );
}
