export type LocalView = "titlebar" | "status" | "credits";

export function resolveLocalView(search: string, fallbackLabel: string | null): LocalView {
  const params = new URLSearchParams(search);
  const selected = params.get("view");
  if (selected === "titlebar" || selected === "status" || selected === "credits") {
    return selected;
  }
  if (params.get("preview") === "titlebar") return "titlebar";
  if (fallbackLabel === "titlebar" || fallbackLabel === "credits") return fallbackLabel;
  return "status";
}
