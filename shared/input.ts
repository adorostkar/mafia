export function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) =>
    String(digit.charCodeAt(0) & 15),
  );
}

// Persian needs the zero-width non-joiner, and some emoji need the joiner.
const joiners = /[\u200c\u200d]/g;

export function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, (character) =>
      character === "\u200c" || character === "\u200d" ? character : "",
    )
    .replace(/ {2,}/g, " ")
    .replace(/^[ \u200c\u200d]+|[ \u200c\u200d]+$/g, "");
}

export function nameKey(value: string): string {
  return normalizeName(value).replace(joiners, "").toLowerCase();
}

// Keeps a name in one piece when it sits inside a sentence of the other direction.
export function isolate(value: string): string {
  return `\u2068${value}\u2069`;
}
