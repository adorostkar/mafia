import { createInstance } from "i18next";
import en from "./locales/en.json";

export type Catalog = typeof en;
export type Language = string;
type MessageKey<K extends string> = K extends `${infer Base}_${"one" | "other"}`
  ? Base
  : K;
type Values = Record<string, string | number>;

export const catalogs: Record<string, Catalog> = {};
const files = import.meta.glob<Catalog>("./locales/*.json", {
  eager: true,
  import: "default",
});
for (const catalog of Object.values(files)) {
  if (catalog.meta.enabled) catalogs[catalog.meta.code] = catalog;
}
export const languages = Object.values(catalogs).map((catalog) => catalog.meta);

const engine = createInstance();
void engine.init({
  resources: Object.fromEntries(
    Object.entries(catalogs).map(([code, catalog]) => [
      code,
      { translation: catalog },
    ]),
  ),
  lng: "en",
  fallbackLng: "en",
  initAsync: false,
  interpolation: { escapeValue: false },
});

export function supportedLanguage(value: string | null | undefined): Language {
  if (value && Object.hasOwn(catalogs, value)) return value;
  const base = value?.split("-")[0];
  return base && Object.hasOwn(catalogs, base) ? base : "en";
}

const cache = new Map<string, ReturnType<typeof createTranslation>>();
function createTranslation(language: string) {
  const catalog = catalogs[language];
  const number = new Intl.NumberFormat(language);
  const date = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const list = new Intl.ListFormat(language);
  return {
    ...catalog,
    language,
    message: (
      key: MessageKey<keyof Catalog["messages"]>,
      values: Values = {},
    ) => engine.t(`messages.${key}`, { ...values, lng: language }),
    event: (key: keyof Catalog["events"], values: Values) =>
      engine.t(`events.${key}`, { ...values, lng: language }),
    notice: (key: keyof Catalog["notices"], values: Values) =>
      engine.t(`notices.${key}`, { ...values, lng: language }),
    number: (value: number) => number.format(value),
    date: (value: number) => date.format(value),
    list: (values: string[]) => list.format(values),
  };
}
export function translations(value: Language) {
  const language = supportedLanguage(value);
  let t = cache.get(language);
  if (!t) {
    t = createTranslation(language);
    cache.set(language, t);
  }
  return t;
}
export type Translation = ReturnType<typeof createTranslation>;
