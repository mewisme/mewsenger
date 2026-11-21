import { AccountsSection } from "@/ui/accounts-section";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Button } from "@/components/ui/button";
import appIcon from "../../src-tauri/icons/128x128.png";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";
import { updateActionable, updateTooltip } from "@/ui/status-types";
import { useUpdate } from "@/ui/use-update";

type Theme = "system" | "dark" | "light";
const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

interface Preferences {
  theme: Theme;
  notification_preview: boolean;
  block_typing: boolean;
  hide_avatars: boolean;
  redact_mode: boolean;
  spell_check: boolean;
  auto_recover: boolean;
  read_ahead: boolean;
  double_click_reply: boolean;
  trim_idle_memory: boolean;
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

export function Settings({ version, overlay = false }: { version: string; overlay?: boolean }) {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { update, act } = useUpdate();
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [copied, setCopied] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);

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

  function setTheme(value: Theme) {
    const previous = prefs;
    setError(null);
    setPrefs((current) => (current ? { ...current, theme: value } : current));
    invoke<Preferences>("set_theme_preference", { value })
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

  function sendTestNotification() {
    setTestStatus("Sending notification request…");
    invoke("test_notification")
      .then(() => setTestStatus("Request sent; check Windows notifications"))
      .catch(() => setTestStatus("Notification request failed"));
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
      {overlay && (
        <header className="-mt-1 flex items-center justify-between gap-4">
          <h1 className="text-base font-semibold">Settings</h1>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close settings"
            onClick={() => { void invoke("close_settings").catch(() => {}); }}>
            <X aria-hidden="true" />
          </Button>
        </header>
      )}
      <section aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" className="text-sm font-semibold">Appearance</h2>
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="min-w-0">
            <p id="theme-label" className="text-sm font-medium">Theme</p>
            <p className="text-xs text-muted-foreground">Messenger follows it when its own appearance is set to the system's.</p>
          </div>
          <div role="radiogroup" aria-labelledby="theme-label" className="flex shrink-0 gap-1">
            {THEMES.map(({ value, label }) => (
              <Button key={value} type="button" role="radio" size="sm"
                variant={(prefs?.theme ?? "system") === value ? "secondary" : "ghost"}
                aria-checked={(prefs?.theme ?? "system") === value}
                disabled={prefs === null}
                onClick={() => setTheme(value)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      </section>
      <section aria-labelledby="settings-notifications">
        <h2 id="settings-notifications" className="text-sm font-semibold">Notifications</h2>
        <Row
          id="pref-preview"
          label="Show message previews in notifications"
          checked={prefs?.notification_preview ?? true}
          disabled={prefs === null}
          onChange={(value) => setPreference("notification_preview", value)}
        />
        <div className="flex items-center justify-between gap-4 py-2">
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {testStatus ?? "Send a test notification to the operating system."}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={sendTestNotification}>
            Send test notification
          </Button>
        </div>
      </section>
      <section aria-labelledby="settings-privacy">
        <h2 id="settings-privacy" className="text-sm font-semibold">Privacy</h2>
        <Row
          id="pref-block-typing"
          label="Hide that I am typing"
          hint="People in a chat do not see the typing dots."
          checked={prefs?.block_typing ?? false}
          disabled={prefs === null}
          onChange={(value) => setPreference("block_typing", value)}
        />
        <Row
          id="pref-hide-avatars"
          label="Show initials instead of profile pictures"
          hint="For screens others can see."
          checked={prefs?.hide_avatars ?? false}
          disabled={prefs === null}
          onChange={(value) => setPreference("hide_avatars", value)}
        />
        <Row
          id="pref-redact"
          label="Cover names, messages and photos"
          hint="Names, previews and messages become bars; photos go dark."
          checked={prefs?.redact_mode ?? false}
          disabled={prefs === null}
          onChange={(value) => setPreference("redact_mode", value)}
        />
      </section>
      <section aria-labelledby="settings-chat">
        <h2 id="settings-chat" className="text-sm font-semibold">Chat</h2>
        <Row
          id="pref-spell-check"
          label="Check spelling in message fields"
          checked={prefs?.spell_check ?? true}
          disabled={prefs === null}
          onChange={(value) => setPreference("spell_check", value)}
        />
        <Row
          id="pref-double-click-reply"
          label="Double-click a message to reply"
          hint="Double-click empty space next to the text."
          checked={prefs?.double_click_reply ?? false}
          disabled={prefs === null}
          onChange={(value) => setPreference("double_click_reply", value)}
        />
        <Row
          id="pref-read-ahead"
          label="Load top chats ahead of time"
          hint="Chats at the top of the list open instantly. Uses a little more data."
          checked={prefs?.read_ahead ?? false}
          disabled={prefs === null}
          onChange={(value) => setPreference("read_ahead", value)}
        />
        <Row
          id="pref-auto-recover"
          label="Reload Messenger by itself when it is stuck"
          hint="After the computer wakes, when the connection stays down, or when chats fail to load."
          checked={prefs?.auto_recover ?? true}
          disabled={prefs === null}
          onChange={(value) => setPreference("auto_recover", value)}
        />
        <Row
          id="pref-trim-memory"
          label="Use less memory when idle"
          hint="Tabs you have not looked at for 5 minutes, or the whole app when minimized or in the background, give memory back. Notifications keep working."
          checked={prefs?.trim_idle_memory ?? true}
          disabled={prefs === null}
          onChange={(value) => setPreference("trim_idle_memory", value)}
        />
      </section>
      <AccountsSection />
      <section aria-labelledby="settings-startup">
        <h2 id="settings-startup" className="text-sm font-semibold">Startup</h2>
        <Row
          id="pref-autostart"
          label="Launch Mewsenger when I sign in to Windows"
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
      <section aria-labelledby="settings-about" className="mt-auto flex items-center gap-3">
        <img src={appIcon} alt="Mewsenger icon" className="size-10 shrink-0" />
        <div className="min-w-0">
          <h2 id="settings-about" className="text-sm font-semibold">Mewsenger</h2>
          <p className="text-xs text-muted-foreground">Version {version} · Made by Mew</p>
          <p className="text-xs text-muted-foreground">Desktop client powered by Tauri, React and shadcn/ui.</p>
        </div>
      </section>
    </main>
  );
}
