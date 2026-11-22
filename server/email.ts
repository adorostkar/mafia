import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";

export type MailKind = "verification" | "reset";
export interface MailMessage {
  id: string;
  kind: MailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
export class EmailBudgetError extends Error {
  constructor() {
    super("The daily email limit is reached.");
  }
}

// Keeps the app below the provider's daily quota. Sign-up emails may use most of
// the budget, but not all of it, so password resets still work when sign-up is flooded.
export function limitDailyEmail(
  mailer: Mailer,
  dailyLimit: number,
  now: () => number = Date.now,
): Mailer {
  const sent: { at: number; kind: MailKind }[] = [];
  const verificationLimit = Math.max(1, Math.floor(dailyLimit * 0.7));
  return {
    async send(message) {
      const cutoff = now() - 24 * 60 * 60_000;
      while (sent.length && sent[0].at <= cutoff) sent.shift();
      const verifications = sent.filter(
        (entry) => entry.kind === "verification",
      ).length;
      if (
        sent.length >= dailyLimit ||
        (message.kind === "verification" && verifications >= verificationLimit)
      )
        throw new EmailBudgetError();
      const entry = { at: now(), kind: message.kind };
      sent.push(entry);
      try {
        await mailer.send(message);
      } catch (error) {
        sent.splice(sent.indexOf(entry), 1);
        throw error;
      }
    },
  };
}

export function emailDailyLimit(value: string | undefined): number {
  const text = value?.trim();
  if (!text) return 90;
  const limit = Number(text);
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("EMAIL_DAILY_LIMIT must be a whole number of at least 1.");
  return limit;
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());

export function createResendMailer(
  environment: Record<string, string | undefined>,
): Mailer | undefined {
  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = environment.EMAIL_FROM?.trim();
  if (!apiKey && !from) return undefined;
  if (!apiKey || !from)
    throw new Error(
      "Set both RESEND_API_KEY and EMAIL_FROM, or leave both empty for recovery-code mode.",
    );
  if (!/^[!-~]{1,512}$/.test(apiKey))
    throw new Error(
      "RESEND_API_KEY must contain only printable ASCII characters without spaces.",
    );
  const address = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  if (
    /[\r\n]/.test(from) ||
    from.length > 512 ||
    !emailSchema.safeParse(address).success
  )
    throw new Error(
      "EMAIL_FROM must be a valid sender, such as Mafia Table <accounts@example.com>.",
    );
  return {
    async send(message) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.id,
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(`Resend email request failed (${response.status}).`);
      const result: unknown = await response.json().catch(() => {
        throw new Error("Resend returned an invalid delivery response.");
      });
      if (!z.object({ id: z.string().min(1) }).safeParse(result).success)
        throw new Error("Resend returned an invalid delivery response.");
    },
  };
}

const catalogSchema = z.object({
  meta: z.object({
    code: z.string(),
    direction: z.enum(["ltr", "rtl"]),
    enabled: z.boolean(),
  }),
  mail: z.object({
    verificationSubject: z.string(),
    verificationIntro: z.string(),
    verificationExpiry: z.string(),
    resetSubject: z.string(),
    resetIntro: z.string(),
    resetExpiry: z.string(),
    resetAction: z.string(),
    ignore: z.string(),
    footer: z.string(),
  }),
});
const directory = new URL("../src/locales/", import.meta.url);
const catalogs = new Map(
  readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) =>
      catalogSchema.parse(
        JSON.parse(readFileSync(new URL(name, directory), "utf8")),
      ),
    )
    .filter((catalog) => catalog.meta.enabled)
    .map((catalog) => [catalog.meta.code, catalog]),
);
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

export function accountEmail(
  kind: "verification" | "reset",
  to: string,
  value: string,
  language: string,
): MailMessage {
  const catalog = catalogs.get(language.split("-")[0]) ?? catalogs.get("en")!;
  const { mail, meta } = catalog;
  const subject = mail[`${kind}Subject`];
  const intro = mail[`${kind}Intro`];
  const expiry = mail[`${kind}Expiry`];
  const content =
    kind === "verification"
      ? `<p dir="ltr" style="font-size:32px;letter-spacing:8px;text-align:center;color:#f5d891">${escapeHtml(value)}</p>`
      : `<p><a href="${escapeHtml(value)}" style="display:inline-block;padding:16px 24px;background:#f5d891;color:#0c1713;border-radius:8px">${escapeHtml(mail.resetAction)}</a></p>`;
  return {
    id: randomUUID(),
    kind,
    to,
    subject,
    text: [intro, value, expiry, mail.ignore, mail.footer].join("\n\n"),
    html: `<html lang="${escapeHtml(meta.code)}" dir="${meta.direction}"><body style="margin:0;padding:32px 16px;background:#0c1713;color:#f5efde;font-family:Arial,sans-serif"><main style="max-width:480px;margin:auto;padding:32px;border:1px solid #a88b53;border-radius:16px"><p style="color:#d6bc80">MAFIA TABLE</p><h1 style="font-size:24px">${escapeHtml(subject)}</h1><p>${escapeHtml(intro)}</p>${content}<p>${escapeHtml(expiry)}</p><p>${escapeHtml(mail.ignore)}</p><hr><p style="font-size:12px">${escapeHtml(mail.footer)}</p></main></body></html>`,
  };
}
