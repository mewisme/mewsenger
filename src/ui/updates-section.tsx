import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/i18n";
import { UPDATE_SCHEDULES, type PreferenceControls, type UpdateSchedule } from "@/ui/preferences";
import { SettingRow, SwitchRow } from "@/ui/setting-row";
import { updateActionable, updateTooltip } from "@/ui/status-types";
import { useUpdate } from "@/ui/use-update";

export function UpdatesSection({ prefs, setPreference, setSchedule }: PreferenceControls) {
  const t = useT();
  const { update, act } = useUpdate();
  const unconfigured = update.state === "unconfigured";
  const locked = prefs === null || unconfigured;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("updates.title")}</CardTitle>
        <CardDescription>{t("updates.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <p role="status" aria-live="polite" className="min-w-0 text-sm text-muted-foreground">
            {updateTooltip(update, t)}
          </p>
          <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={act}
            disabled={!updateActionable(update)}>
            {update.state === "available" ? t("updates.install") : t("updates.check")}
          </Button>
        </div>
        {unconfigured && <p className="text-xs text-muted-foreground">{t("updates.unconfiguredNote")}</p>}
        <Separator />
        <SwitchRow id="pref-check-on-start" label={t("updates.onStartup")} hint={t("updates.onStartupHint")}
          checked={prefs?.check_on_start ?? true} disabled={locked}
          onChange={(value) => setPreference("check_on_start", value)} />
        <SettingRow id="pref-update-schedule" label={t("updates.schedule")} hint={t("updates.scheduleHint")}>
          <Select value={prefs?.update_schedule ?? "daily"} disabled={locked}
            onValueChange={(value) => setSchedule(value as UpdateSchedule)}>
            <SelectTrigger id="pref-update-schedule" aria-label={t("updates.schedule")} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UPDATE_SCHEDULES.map((value) => (
                <SelectItem key={value} value={value}>{t(`updates.schedule.${value}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SwitchRow id="pref-auto-install" label={t("updates.autoInstall")} hint={t("updates.autoInstallHint")}
          checked={prefs?.auto_install ?? false} disabled={locked}
          onChange={(value) => setPreference("auto_install", value)} />
      </CardContent>
    </Card>
  );
}
