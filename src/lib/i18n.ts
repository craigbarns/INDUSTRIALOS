// Keep locale selection and message catalogs separate from business logic.
export const supportedLocales = ["en", "fr", "zh"] as const;
export type Locale = (typeof supportedLocales)[number];
export const defaultLocale: Locale = "en";
export const localeNames: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  zh: "中文",
};
export function formatDate(
  value: string | Date,
  locale: Locale = defaultLocale,
) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
