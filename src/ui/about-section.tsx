import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/i18n";
import appIcon from "../../src-tauri/icons/128x128.png";

type ProjectPage = "repo" | "releases" | "issues" | "license";

function openPage(page: ProjectPage) {
  void invoke("open_project_link", { page }).catch(() => { /* The browser is the only consumer. */ });
}

export function AboutSection({ version }: { version: string }) {
  const t = useT();
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <img src={appIcon} alt={t("about.iconAlt")} className="size-16 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Mewsenger</h2>
            <p className="text-sm text-muted-foreground">{version ? t("about.version", { version }) : t("about.versionUnavailable")}</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t("about.description")}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => openPage("repo")}>{t("about.github")}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => openPage("releases")}>{t("about.releases")}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => openPage("issues")}>{t("about.issues")}</Button>
          <Button type="button" variant="link" size="sm" onClick={() => openPage("license")}>{t("about.license")}</Button>
        </div>
        <Separator />
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t("about.credits")}</h3>
          <p className="text-xs text-muted-foreground">{t("about.madeBy")}</p>
          <p className="text-xs text-muted-foreground">{t("about.poweredBy")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
