import { expect, it } from "vitest";
import {
  errorCodes,
  eventKinds,
  factions,
  noticeKinds,
  roleIds,
  windows,
} from "../shared/game";
import { catalogs, translations } from "./i18n";

function flatten(value: object, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === "string"
        ? [[path, value]]
        : value && typeof value === "object"
          ? Object.entries(flatten(value, path))
          : [];
    }),
  );
}
const baseKey = (key: string) =>
  key.replace(/_(zero|one|two|few|many|other)$/, "");
const variables = (value: string) =>
  [
    ...new Set([...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1])),
  ].sort();

it.each(Object.keys(catalogs))(
  "has complete %s text, valid interpolation, and the language's required plural forms",
  (language) => {
    const { meta, ...text } = catalogs[language];
    expect(meta.code).toBe(language);
    expect(["ltr", "rtl"]).toContain(meta.direction);
    expect(meta.nativeName.trim()).not.toBe("");
    expect(() => new Intl.Locale(language)).not.toThrow();
    const english = flatten(catalogs.en);
    const translated = flatten(text);
    const englishText = Object.fromEntries(
      Object.entries(english).filter(([key]) => !key.startsWith("meta.")),
    );
    expect([...new Set(Object.keys(translated).map(baseKey))].sort()).toEqual(
      [...new Set(Object.keys(englishText).map(baseKey))].sort(),
    );
    for (const [key, value] of Object.entries(translated)) {
      expect(value.trim(), key).not.toBe("");
      const reference = Object.entries(englishText).find(
        ([original]) => baseKey(original) === baseKey(key),
      )![1];
      expect(variables(value), key).toEqual(variables(reference));
    }
    const pluralBases = Object.keys(englishText)
      .filter((key) => key.endsWith("_other"))
      .map(baseKey);
    for (const key of pluralBases) {
      for (const category of new Intl.PluralRules(language).resolvedOptions()
        .pluralCategories) {
        expect(
          translated[`${key}_${category}`],
          `${key}_${category}`,
        ).toBeTruthy();
      }
    }
    for (const role of roleIds) {
      expect(text.role[role]).toBeTruthy();
      expect(text.roleDescription[role]).toBeTruthy();
    }
    for (const window of windows) expect(text.prompt[window]).toBeTruthy();
    for (const faction of factions) expect(text.faction[faction]).toBeTruthy();
    for (const error of errorCodes) expect(text.error[error]).toBeTruthy();
    for (const event of eventKinds) expect(text.events[event]).toBeTruthy();
    for (const notice of noticeKinds) expect(text.notices[notice]).toBeTruthy();
  },
);

it("uses language-specific plural forms and interpolates names without building English sentences", () => {
  expect(translations("en").message("playersCount", { count: 1 })).toBe(
    "1 player",
  );
  expect(translations("en").message("playersCount", { count: 4 })).toBe(
    "4 players",
  );
  expect(translations("fi").message("playersCount", { count: 1 })).toBe(
    "1 pelaaja",
  );
  expect(translations("fi").message("playersCount", { count: 4 })).toBe(
    "4 pelaajaa",
  );
  expect(
    translations("fi").notice("investigation", {
      targets: "Aino",
      value: "Mafia",
    }),
  ).toBe("Aino näyttää kuuluvan ryhmään Mafia.");
});

it("formats Persian counts inside announcements without changing names or join codes", () => {
  const t = translations("fa");
  expect(t.message("playersCount", { count: 4 })).toBe("۴ بازیکن");
  expect(t.message("timerRemaining", { timer: "چالش", count: 10 })).toBe(
    "چالش: ۱۰ ثانیه باقی مانده.",
  );
  expect(t.message("reportTitle", { code: "ABC234" })).toBe("بازی ABC234");
  expect(
    t.message("playerAction", { action: "انتخاب", name: "Player 2" }),
  ).toBe("انتخاب: Player 2");
});
