import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Bell, Info, RefreshCcw, Settings as SettingsIcon, ShieldCheck, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLanguageSetting, useT, type LanguageSetting, type MessageKey } from "@/i18n";
import { AboutSection } from "@/ui/about-section";
import { AccountsSection } from "@/ui/accounts-section";
import type { BoolPreference, PreferenceControls, Preferences, Theme, UpdateSchedule } from "@/ui/preferences";
import { SettingRow, SwitchRow } from "@/ui/setting-row";
import { UpdatesSection } from "@/ui/updates-section";

const THEMES: Theme[] = ["system", "light", "dark"];
const LANGUAGES: LanguageSetting[] = ["system", "en", "vi"];

const TABS = [
  { value: "general", icon: SettingsIcon, label: "settings.tab.general" },
  { value: "accounts", icon: Users, label: "settings.tab.accounts" },
  { value: "privacy", icon: ShieldCheck, label: "settings.tab.privacy" },
  { value: "notifications", icon: Bell, label: "settings.tab.notifications" },
  { value: "updates", icon: RefreshCcw, label: "settings.tab.updates" },
  { value: "about", icon: Info, label: "settings.tab.about" },
] as const satisfies readonly { value: string; icon: unknown; label: MessageKey }[];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {hint && <CardDescription>{hint}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function PrefSwitch({ pref, id, label, hint, fallback, controls }: {
  pref: BoolPreference;
  id: string;
  label: string;
  hint?: string;
  fallback: boolean;
  controls: PreferenceControls;
}) {
  return (
    <SwitchRow id={id} label={label} hint={hint}
      checked={controls.prefs?.[pref] ?? fallback}
      disabled={controls.prefs === null}
      onChange={(value) => controls.setPreference(pref, value)} />
  );
}

export function Settings({ version }: { version: string }) {
  const t = useT();
  const [language, setLanguage] = useLanguageSetting();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      .catch(() => { if (active) setError(t("settings.loadFailed")); });
    void isEnabled()
      .then((value) => { if (active) setAutostart(value); })
      .catch(() => { if (active) setAutostart(null); });
    return () => {
      active = false;
      detach?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Applies a change at once and puts the old value back if the backend refuses it. */
  function save(patch: Partial<Preferences>, command: string, args: Record<string, unknown>) {
    const previous = prefs;
    setError(null);
    setPrefs((current) => (current ? { ...current, ...patch } : current));
    invoke<Preferences>(command, args)
      .then(setPrefs)
      .catch(() => {
        setPrefs(previous);
        setError(t("settings.saveFailed"));
      });
  }

  const controls: PreferenceControls = {
    prefs,
    setPreference: (key, value) => save({ [key]: value }, "set_preference", { key, value }),
    setSchedule: (value: UpdateSchedule) =>
      save({ update_schedule: value }, "set_update_schedule", { value }),
  };

  function setLaunchAtLogin(value: boolean) {
    const previous = autostart;
    setError(null);
    setAutostart(value);
    (value ? enable() : disable()).catch(() => {
      setAutostart(previous);
      setError(t("settings.saveFailed"));
    });
  }

  function sendTestNotification() {
    setTestStatus(t("notifications.sending"));
    invoke("test_notification")
      .then(() => setTestStatus(t("notifications.sent")))
      .catch(() => setTestStatus(t("notifications.failed")));
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
      .catch(() => setError(t("general.copyFailed")));
  }

  const theme = prefs?.theme ?? "system";

  return (
    <main className="flex h-screen w-full flex-col bg-background text-foreground">
      <Tabs defaultValue="general" className="min-h-0 flex-1 gap-0">
        <div className="border-b border-border px-4 pt-3">
          <h1 className="mb-2 text-base font-semibold">{t("settings.title")}</h1>
          <div className="-mb-px overflow-x-auto overflow-y-hidden pb-1">
            <TabsList variant="line" aria-label={t("settings.title")}
              className="h-11 w-max gap-1 p-0">
              {TABS.map(({ value, icon: Icon, label }) => (
                <TabsTrigger key={value} value={value} className="flex-none px-3">
                  <Icon aria-hidden="true" className="size-4" />
                  {t(label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
            {error && (
              <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            )}
            <TabsContent value="general" className="flex flex-col gap-4">
              <Section title={t("general.appearance")} hint={t("general.appearanceHint")}>
                <SettingRow id="pref-language" label={t("general.language")} hint={t("general.languageHint")}>
                  <Select value={language} onValueChange={(value) => setLanguage(value as LanguageSetting)}>
                    <SelectTrigger id="pref-language" aria-label={t("general.language")} className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((value) => (
                        <SelectItem key={value} value={value}>{t(`general.language.${value}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Label id="theme-label" className="text-sm font-medium">{t("general.theme")}</Label>
                    <p className="text-xs text-muted-foreground">{t("general.themeHint")}</p>
                  </div>
                  <ToggleGroup type="single" variant="outline" size="sm" value={theme}
                    aria-labelledby="theme-label" disabled={prefs === null} className="shrink-0"
                    onValueChange={(value) => {
                      if (value) save({ theme: value as Theme }, "set_theme_preference", { value });
                    }}>
                    {THEMES.map((value) => (
                      <ToggleGroupItem key={value} value={value}>{t(`general.theme.${value}`)}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </Section>
              <Section title={t("general.window")}>
                <PrefSwitch controls={controls} pref="close_to_tray" id="pref-close-to-tray" fallback={false}
                  label={t("general.closeToTray")} hint={t("general.closeToTrayHint")} />
                <SwitchRow id="pref-autostart" label={t("general.autostart")} hint={t("general.autostartHint")}
                  checked={autostart ?? false} disabled={autostart === null} onChange={setLaunchAtLogin} />
              </Section>
              <Section title={t("general.chat")}>
                <PrefSwitch controls={controls} pref="spell_check" id="pref-spell-check" fallback
                  label={t("general.spellCheck")} hint={t("general.spellCheckHint")} />
                <PrefSwitch controls={controls} pref="double_click_reply" id="pref-double-click-reply" fallback={false}
                  label={t("general.doubleClickReply")} hint={t("general.doubleClickReplyHint")} />
                <PrefSwitch controls={controls} pref="read_ahead" id="pref-read-ahead" fallback={false}
                  label={t("general.readAhead")} hint={t("general.readAheadHint")} />
                <PrefSwitch controls={controls} pref="auto_recover" id="pref-auto-recover" fallback
                  label={t("general.autoRecover")} hint={t("general.autoRecoverHint")} />
              </Section>
              <Section title={t("general.performance")}>
                <PrefSwitch controls={controls} pref="trim_idle_memory" id="pref-trim-memory" fallback
                  label={t("general.trimMemory")} hint={t("general.trimMemoryHint")} />
              </Section>
              <Section title={t("general.diagnostics")} hint={t("general.diagnosticsHint")}>
                <div className="flex items-center gap-3">
                  <Button type="button" variant="secondary" size="sm" onClick={copyDiagnostics}>
                    {t("general.copyDiagnostics")}
                  </Button>
                  {copied && <p role="status" className="text-xs text-muted-foreground">{t("general.copied")}</p>}
                </div>
                {diagnostics && (
                  <pre aria-label={t("general.diagnosticsLabel")}
                    className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs">
                    {JSON.stringify(diagnostics, null, 2)}
                  </pre>
                )}
              </Section>
            </TabsContent>
            <TabsContent value="accounts" className="flex flex-col gap-4">
              <AccountsSection />
            </TabsContent>
            <TabsContent value="privacy" className="flex flex-col gap-4">
              <Section title={t("privacy.title")} hint={t("privacy.hint")}>
                <PrefSwitch controls={controls} pref="block_typing" id="pref-block-typing" fallback={false}
                  label={t("privacy.blockTyping")} hint={t("privacy.blockTypingHint")} />
                <PrefSwitch controls={controls} pref="hide_avatars" id="pref-hide-avatars" fallback={false}
                  label={t("privacy.hideAvatars")} hint={t("privacy.hideAvatarsHint")} />
                <PrefSwitch controls={controls} pref="redact_mode" id="pref-redact" fallback={false}
                  label={t("privacy.redact")} hint={t("privacy.redactHint")} />
              </Section>
            </TabsContent>
            <TabsContent value="notifications" className="flex flex-col gap-4">
              <Section title={t("notifications.title")} hint={t("notifications.hint")}>
                <PrefSwitch controls={controls} pref="notification_preview" id="pref-preview" fallback
                  label={t("notifications.preview")} hint={t("notifications.previewHint")} />
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <p role="status" aria-live="polite" className="min-w-0 text-xs text-muted-foreground">
                    {testStatus ?? t("notifications.testHint")}
                  </p>
                  <Button type="button" variant="secondary" size="sm" className="shrink-0"
                    onClick={sendTestNotification}>
                    {t("notifications.test")}
                  </Button>
                </div>
              </Section>
            </TabsContent>
            <TabsContent value="updates" className="flex flex-col gap-4">
              <UpdatesSection {...controls} />
            </TabsContent>
            <TabsContent value="about" className="flex flex-col gap-4">
              <AboutSection version={version} />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </main>
  );
}
