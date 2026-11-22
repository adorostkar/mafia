import { afterEach, expect, it, vi } from "vitest";
import {
  accountEmail,
  createResendMailer,
  EmailBudgetError,
  emailDailyLimit,
  limitDailyEmail,
} from "./email.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("delivers localized plain-text and HTML mail through Resend without putting the API key in the message", async () => {
  const send = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ id: "test-message" }), { status: 200 }),
    );
  vi.stubGlobal("fetch", send);
  const mailer = createResendMailer({
    RESEND_API_KEY: "re_test_only_not_a_real_key",
    EMAIL_FROM: "Mafia Table <accounts@example.com>",
  });

  const message = accountEmail(
    "verification",
    "aino@example.com",
    "004012",
    "fi-FI",
  );
  await mailer!.send(message);
  const [url, options] = send.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect(options.headers.Authorization).toBe(
    "Bearer re_test_only_not_a_real_key",
  );
  expect(options.headers["Idempotency-Key"]).toBe(message.id);
  const body = JSON.parse(options.body);
  expect(body).toMatchObject({
    from: "Mafia Table <accounts@example.com>",
    to: "aino@example.com",
    subject: "Vahvista Mafia Table -sähköpostiosoitteesi",
  });
  expect(body.text).toContain("\n\n004012\n\n");
  expect(body.html).toContain('lang="fi"');
  expect(body.html).toContain("004012");
  expect(options.body).not.toContain("re_test_only");
});

it("disables email only when both settings are absent and rejects incomplete or unsafe sender settings", () => {
  expect(createResendMailer({})).toBeUndefined();
  expect(() =>
    createResendMailer({ EMAIL_FROM: "accounts@example.com" }),
  ).toThrow("both");
  expect(() => createResendMailer({ RESEND_API_KEY: "re_test_only" })).toThrow(
    "both",
  );
  expect(() =>
    createResendMailer({
      RESEND_API_KEY: "re_test_only",
      EMAIL_FROM: "accounts@example.com\r\nBcc: other@example.com",
    }),
  ).toThrow("EMAIL_FROM");
});

it("surfaces delivery failures instead of reporting success or including provider response details", async () => {
  const send = vi
    .fn()
    .mockResolvedValue(
      new Response("private provider detail", { status: 429 }),
    );
  vi.stubGlobal("fetch", send);
  const mailer = createResendMailer({
    RESEND_API_KEY: "re_test_only",
    EMAIL_FROM: "accounts@example.com",
  })!;
  const message = accountEmail(
    "verification",
    "aino@example.com",
    "004012",
    "en",
  );
  await expect(mailer.send(message)).rejects.toThrow(
    "Resend email request failed (429).",
  );
  send.mockResolvedValueOnce(new Response("{}", { status: 200 }));
  await expect(mailer.send(message)).rejects.toThrow(
    "invalid delivery response",
  );
  send.mockResolvedValueOnce(
    new Response("private provider detail", { status: 200 }),
  );
  await expect(mailer.send(message)).rejects.toThrow(
    "Resend returned an invalid delivery response.",
  );
});

it("keeps part of the daily email budget free for password resets", async () => {
  let clock = 1_000;
  let failing = false;
  const delivered: string[] = [];
  const mailer = limitDailyEmail(
    {
      send: async (message) => {
        if (failing) throw new Error("provider down");
        delivered.push(message.kind);
      },
    },
    10,
    () => clock,
  );
  const mail = (kind: "verification" | "reset") =>
    accountEmail(kind, "aino@example.com", "004012", "en");
  failing = true;
  await expect(mailer.send(mail("verification"))).rejects.toThrow(
    "provider down",
  );
  failing = false;
  for (let n = 0; n < 7; n++) await mailer.send(mail("verification"));
  await expect(mailer.send(mail("verification"))).rejects.toThrow(
    EmailBudgetError,
  );
  for (let n = 0; n < 3; n++) await mailer.send(mail("reset"));
  await expect(mailer.send(mail("reset"))).rejects.toThrow(EmailBudgetError);
  expect(delivered).toHaveLength(10);
  clock += 24 * 60 * 60_000;
  await mailer.send(mail("verification"));
  expect(delivered).toHaveLength(11);
  expect(emailDailyLimit(undefined)).toBe(90);
  expect(emailDailyLimit(" 250 ")).toBe(250);
  for (const bad of ["0", "-5", "1.5", "many"])
    expect(() => emailDailyLimit(bad)).toThrow("EMAIL_DAILY_LIMIT");
});
