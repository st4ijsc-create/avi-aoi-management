import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

const localeMap = { en: "en-US", vi: "vi-VN", zh: "zh-CN" } as const;

function resolveLocale(lang: string | undefined): string {
  if (!lang) return "en-US";
  const base = lang.split("-")[0] as keyof typeof localeMap;
  return localeMap[base] ?? "en-US";
}

/** Returns the resolved BCP-47 locale for the currently active i18n language. */
export function getActiveLocale(): string {
  return resolveLocale(i18n.language);
}

/**
 * i18n-aware date formatters bound to the current i18next language.
 * Use inside React components.
 */
export function useLocaleDate() {
  const { i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  return {
    short: (d: Date | string | number) => new Date(d).toLocaleDateString(locale),
    long: (d: Date | string | number) =>
      new Date(d).toLocaleDateString(locale, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    dateTime: (d: Date | string | number) =>
      new Date(d).toLocaleString(locale),
  };
}

/** Non-hook variant for places where a language code is already known. */
export function formatLocaleDate(
  d: Date | string | number,
  lang: string | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(d).toLocaleDateString(resolveLocale(lang), opts);
}
