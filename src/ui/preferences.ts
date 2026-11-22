export type Theme = "system" | "dark" | "light";

export const UPDATE_SCHEDULES = [
  "off", "hourly", "every_6_hours", "every_12_hours", "daily", "weekly", "monthly", "even_days", "odd_days",
] as const;
export type UpdateSchedule = typeof UPDATE_SCHEDULES[number];

export interface Preferences {
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
  close_to_tray: boolean;
  check_on_start: boolean;
  auto_install: boolean;
  update_schedule: UpdateSchedule;
}

export type BoolPreference = {
  [K in keyof Preferences]: Preferences[K] extends boolean ? K : never;
}[keyof Preferences];

/** What the section components need from the settings screen. */
export interface PreferenceControls {
  /** Null until the backend has answered. */
  prefs: Preferences | null;
  setPreference: (key: BoolPreference, value: boolean) => void;
  setSchedule: (value: UpdateSchedule) => void;
}
