import { useCallback, useSyncExternalStore } from "react";
import { en, type MessageKey } from "./en";
import { vi } from "./vi";

export type { MessageKey };
export type Language = "en" | "vi";
export type LanguageSetting = "system" | Language;

export const LANGUAGE_STORAGE_KEY = "mew-language";
const CATALOGS: Record<Language, Record<MessageKey, string>> = { en, vi };

/** Language a setting resolves to; "system" follows the browser language, falling back to English. */
export function resolveLanguage(setting: string | null | undefined, systemLanguage: string | undefined): Language {
  if (setting === "en" || setting === "vi") return setting;
  return systemLanguage?.toLowerCase().startsWith("vi") ? "vi" : "en";
}

export function readLanguageSetting(): LanguageSetting {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === "en" || stored === "vi" ? stored : "system";
  } catch {
    return "system";
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Other local views write the same key; their change arrives as a storage event.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LANGUAGE_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function writeLanguageSetting(setting: LanguageSetting) {
  try {
    if (setting === "system") localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    else localStorage.setItem(LANGUAGE_STORAGE_KEY, setting);
  } catch { /* Without storage the choice only lasts until reload. */ }
  listeners.forEach((listener) => listener());
}

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function translate(language: Language, key: MessageKey, values?: Record<string, string | number>): string {
  const text = CATALOGS[language][key] ?? en[key];
  return values
    ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match))
    : text;
}

/** The current language setting and a setter that updates every local view. */
export function useLanguageSetting(): [LanguageSetting, (setting: LanguageSetting) => void] {
  const setting = useSyncExternalStore(subscribe, readLanguageSetting, () => "system" as LanguageSetting);
  return [setting, writeLanguageSetting];
}

export function useT(): Translate {
  const [setting] = useLanguageSetting();
  const language = resolveLanguage(setting, typeof navigator === "undefined" ? undefined : navigator.language);
  return useCallback((key, values) => translate(language, key, values), [language]);
}
