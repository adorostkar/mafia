import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  AuthStore,
  hashToken,
  loginSchema,
  passwordSchema,
  sessionSchema,
  usernameSchema,
  type AuthSession,
} from "./auth.js";
import { codeSchema, commandSchema, nameSchema } from "./validation.js";
import { GameError, GameStore } from "./game.js";
import { emailSchema, type Mailer } from "./email.js";
import { normalizeDigits } from "../shared/input.js";

interface AppOptions {
  secureCookies?: boolean;
  publicOrigin?: string;
  trustProxy?: string[];
  email?: Mailer;
  // Receives one line for each write request and each failed request.
  log?: (line: string) => void;
}
export function createApp(db: DatabaseSync, options: AppOptions = {}) {
  if (options.email && !options.publicOrigin)
    throw new Error("Email recovery requires PUBLIC_ORIGIN.");
  const app = express();
  const store = new GameStore(db);
  const auth = new AuthStore(db, options.email);
  const streams = new Map<
    string,
    Set<{ response: Response; session: AuthSession }>
  >();
  app.disable("x-powered-by");
  if (options.trustProxy?.length) app.set("trust proxy", options.trustProxy);
  app.use((req, res, next) => {
    const nonce = randomBytes(18).toString("base64");
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    });
    if (options.secureCookies)
      res.set("Strict-Transport-Security", "max-age=31536000");
    if (options.log) {
      const log = options.log;
      const started = performance.now();
      res.on("finish", () => {
        // Reads that work, and the normal "not signed in" or "not a member" answers, stay quiet.
        const quiet =
          req.method === "GET" &&
          (res.statusCode < 400 || [401, 403, 404].includes(res.statusCode));
        if (quiet || !req.originalUrl.startsWith("/api/")) return;
        const path = req.originalUrl
          .split("?")[0]
          .replace(/\/games\/[A-Za-z0-9]{6}/, "/games/:code");
        const error = res.locals.errorCode ? ` ${res.locals.errorCode}` : "";
        log(
          `${req.method} ${path} ${res.statusCode} ${Math.round(performance.now() - started)}ms${error}`,
        );
      });
    }
    next();
  });
  app.get("/healthz", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.set("Cache-Control", "no-store").json({ status: "ok" });
  });
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 6000,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "rateLimit" },
    }),
  );
  app.use("/api", (req, _res, next) => {
    if (
      req.method !== "GET" &&
      (req.get("X-Mafia-Client") !== "1" ||
        !req.is("application/json") ||
        req.get("Sec-Fetch-Site") === "cross-site" ||
        (req.get("origin") &&
          req.get("origin") !==
            (options.publicOrigin ?? `${req.protocol}://${req.get("host")}`)))
    )
      throw new GameError("csrf", 403);
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  const cookieToken = (cookie: string | undefined) =>
    cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("mafia_session="))
      ?.slice(14);
  const setCookie = (res: Response, token: string, maxAge: number) =>
    res.cookie("mafia_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: options.secureCookies ?? false,
      maxAge,
      path: "/",
    });
  const setSession = (
    res: Response,
    value: { token: string; maxAge: number; session: AuthSession },
  ) => {
    setCookie(res, value.token, value.maxAge);
    return auth.identity(value.session);
  };
  // Finds the session of a request and keeps a session that is in use alive.
  const currentSession = (req: Request, res: Response) => {
    const token = cookieToken(req.headers.cookie);
    const found = auth.session(token);
    if (found && token) {
      const maxAge = auth.renew(found);
      if (maxAge) setCookie(res, token, maxAge);
    }
    return found;
  };
  // Only the app's own script may start a new guest. A link or redirect from
  // another website must never replace the visitor's session cookie.
  const fromApp = (req: Request) =>
    req.get("X-Mafia-Client") === "1" &&
    req.get("Sec-Fetch-Site") !== "cross-site" &&
    req.get("Sec-Fetch-Mode") !== "navigate";
  const guestLimit = rateLimit({
    windowMs: 60 * 60_000,
    limit: 120,
    message: { error: "rateLimit" },
  });
  app.get(
    "/api/me",
    rateLimit({ windowMs: 60_000, limit: 90, message: { error: "rateLimit" } }),
    (req, res, next) => {
      const found = currentSession(req, res);
      if (found) {
        res.json(auth.identity(found));
        return;
      }
      if (!fromApp(req)) throw new GameError("authentication", 401);
      void guestLimit(req, res, (error?: unknown) => {
        if (error) next(error);
        else res.json(setSession(res, auth.guest()));
      });
    },
  );
  app.use("/api", (req, res, next) => {
    const found = currentSession(req, res);
    if (!found) throw new GameError("authentication", 401);
    res.locals.session = found;
    next();
  });
  const session = (res: Response) => sessionSchema.parse(res.locals.session);
  const profile = (res: Response) => session(res).profileId;
  const notify = (code: string) => {
    for (const client of streams.get(code) ?? []) {
      if (!auth.isValid(client.session)) {
        client.response.write("event: session\ndata: {}\n\n");
        client.response.end();
      } else if (!client.response.write("event: update\ndata: {}\n\n"))
        client.response.end();
    }
  };
  // Tells only the tables of these profiles that something about a member changed.
  const notifyProfiles = (...profiles: string[]) => {
    const codes = new Set(profiles.flatMap((id) => store.codesFor(id)));
    for (const code of codes) if (streams.has(code)) notify(code);
  };
  const accountIpLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 90,
    message: { error: "rateLimit" },
  });
  const usernameKey = (req: Request) =>
    hashToken(
      loginSchema.shape.username.safeParse(req.body?.username).data ??
        "invalid-username",
    );
  // Wrong guesses are counted per username and address together, so a stranger
  // cannot lock the real owner out. A much higher limit per username alone
  // still slows down guessing from many addresses.
  const accountNameLimit = [
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 200,
      skipSuccessfulRequests: true,
      keyGenerator: usernameKey,
      message: { error: "rateLimit" },
    }),
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 12,
      skipSuccessfulRequests: true,
      keyGenerator: (req) =>
        `${usernameKey(req)}:${ipKeyGenerator(req.ip ?? "")}`,
      message: { error: "rateLimit" },
    }),
  ];
  app.use("/api/auth", accountIpLimit);
  app.use(
    "/api/account",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 90,
      message: { error: "rateLimit" },
    }),
  );
  const newCredentials = z
    .object({
      username: usernameSchema,
      password: passwordSchema,
      confirmPassword: z.string(),
    })
    .refine((value) => value.password === value.confirmPassword);
  const emailLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    skip: () => !options.email,
    keyGenerator: (req, res) =>
      hashToken(
        req.route.path === "/api/auth/resend-verification"
          ? (auth.identity(session(res)).pendingEmail ?? "invalid-email")
          : (emailSchema.safeParse(req.body?.email).data ?? "invalid-email"),
      ),
    message: { error: "rateLimit" },
  });
  // One address may only cause a few emails per hour, whoever they are sent to.
  const emailIpLimit = rateLimit({
    windowMs: 60 * 60_000,
    limit: 20,
    skip: () => !options.email,
    message: { error: "rateLimit" },
  });
  app.post(
    "/api/auth/register",
    ...accountNameLimit,
    emailIpLimit,
    emailLimit,
    async (req, res) => {
      const { username, password } = newCredentials.parse(req.body);
      if (options.email) {
        const { email, language } = z
          .object({
            email: emailSchema,
            language: z.string().max(35).default("en"),
          })
          .parse(req.body);
        await auth.beginEmailRegistration(
          session(res),
          username,
          password,
          email,
          language,
        );
        res.status(202).json({ identity: auth.identity(session(res)) });
        return;
      }
      const result = await auth.register(session(res), username, password);
      notifyProfiles(result.session.profileId);
      res.status(201).json({
        identity: setSession(res, result),
        recoveryCode: result.recoveryCode,
      });
    },
  );
  app.post("/api/auth/verify-email", (req, res) => {
    if (!options.email) throw new GameError("notFound", 404);
    const { code } = z
      .object({
        code: z
          .string()
          .trim()
          .transform(normalizeDigits)
          .pipe(z.string().regex(/^\d{6}$/)),
      })
      .parse(req.body);
    const result = auth.verifyEmail(session(res), code);
    notifyProfiles(result.session.profileId);
    res.status(201).json({ identity: setSession(res, result) });
  });
  app.post(
    "/api/auth/resend-verification",
    emailIpLimit,
    emailLimit,
    async (req, res) => {
      const { language } = z
        .object({ language: z.string().max(35).default("en") })
        .parse(req.body);
      await auth.resendVerification(session(res), language);
      res.status(202).json({ identity: auth.identity(session(res)) });
    },
  );
  app.post("/api/auth/request-reset", emailIpLimit, emailLimit, (req, res) => {
    if (!options.email || !options.publicOrigin)
      throw new GameError("notFound", 404);
    const { email, language } = z
      .object({
        email: emailSchema,
        language: z.string().max(35).default("en"),
      })
      .parse(req.body);
    // Provider latency and delivery errors must not disclose account existence.
    res.status(202).json({ ok: true });
    void auth
      .requestEmailReset(email, language, options.publicOrigin)
      .catch((error: unknown) => {
        console.error("Could not send a password reset email", error);
      });
  });
  app.post("/api/auth/reset-password", async (req, res) => {
    if (!options.email) throw new GameError("notFound", 404);
    const { token, password } = z
      .object({
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        password: passwordSchema,
        confirmPassword: z.string(),
      })
      .refine((value) => value.password === value.confirmPassword)
      .parse(req.body);
    const current = session(res);
    const changed = await auth.resetPassword(token, password);
    const identity = auth.isValid(current)
      ? auth.identity(current)
      : setSession(res, auth.guest());
    notifyProfiles(changed, current.profileId);
    res.json({ identity });
  });
  app.post("/api/auth/login", ...accountNameLimit, async (req, res) => {
    const { username, password, adoptGuest } = loginSchema.parse(req.body);
    const previous = session(res);
    const result = await auth.login(previous, username, password, adoptGuest);
    notifyProfiles(result.session.profileId, previous.profileId);
    res.json({ identity: setSession(res, result) });
  });
  app.post("/api/auth/logout", (_req, res) => {
    const previous = session(res);
    const result = auth.logout(previous);
    notifyProfiles(previous.profileId);
    res.json({ identity: setSession(res, result) });
  });
  app.post("/api/auth/recover", ...accountNameLimit, async (req, res) => {
    const { username, code, password } = newCredentials
      .safeExtend({
        code: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{32}$/),
      })
      .parse(req.body);
    const current = session(res);
    const result = await auth.recover(username, code, password);
    const identity = auth.isValid(current)
      ? auth.identity(current)
      : setSession(res, auth.guest());
    notifyProfiles(result.profileId, current.profileId);
    res.json({ identity, recoveryCode: result.recoveryCode });
  });
  app.post("/api/account/password", async (req, res) => {
    const body = z
      .object({
        currentPassword: z.string().max(128),
        password: passwordSchema,
        confirmPassword: z.string(),
      })
      .refine((value) => value.password === value.confirmPassword)
      .parse(req.body);
    const result = await auth.changePassword(
      session(res),
      body.currentPassword,
      body.password,
    );
    notifyProfiles(result.session.profileId);
    res.json({ identity: setSession(res, result) });
  });
  app.post("/api/account/recovery", async (req, res) => {
    const { password } = z
      .object({ password: z.string().min(1).max(128) })
      .parse(req.body);
    const result = await auth.rotateRecovery(session(res), password);
    notifyProfiles(result.session.profileId);
    res.json({
      identity: setSession(res, result),
      recoveryCode: result.recoveryCode,
    });
  });
  app.get("/api/account/sessions", (_req, res) =>
    res.json(auth.sessions(session(res))),
  );
  app.post("/api/account/sessions/revoke", (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    auth.revoke(session(res), id);
    notifyProfiles(profile(res));
    res.json({ ok: true });
  });
  app.get("/api/account/export", (_req, res) => {
    const current = session(res);
    res.set(
      "Content-Disposition",
      'attachment; filename="mafia-table-data.json"',
    );
    res.json({
      exportedAt: new Date().toISOString(),
      identity: auth.identity(current),
      sessions: auth.sessions(current),
      games: store.export(current.profileId),
    });
  });
  app.post("/api/account/delete", async (req, res) => {
    const { password } = z
      .object({
        confirm: z.literal(true),
        password: z.string().max(128).optional(),
      })
      .parse(req.body);
    const current = session(res);
    // Look the tables up first: deleting moves them to an anonymous profile.
    const codes = store.codesFor(current.profileId);
    const result = await auth.deleteProfile(current, password);
    for (const code of codes) if (streams.has(code)) notify(code);
    res.json({ identity: setSession(res, result) });
  });
  app.get("/api/games", (_req, res) => res.json(store.list(profile(res))));
  app.post(
    "/api/games",
    rateLimit({
      windowMs: 60 * 60_000,
      limit: 40,
      message: { error: "rateLimit" },
    }),
    (_req, res) => {
      res.status(201).json({ code: store.create(profile(res)) });
    },
  );
  const joinLimiter = rateLimit({
    windowMs: 60_000,
    limit: 90,
    message: { error: "rateLimit" },
  });
  app.post("/api/games/:code/join", joinLimiter, (req, res) => {
    const code = codeSchema.parse(req.params.code);
    const { name } = z.object({ name: nameSchema }).parse(req.body);
    store.join(code, profile(res), name);
    notify(code);
    res.json(store.view(code, profile(res)));
  });
  app.get("/api/games/:code", (req, res) =>
    res.json(store.view(codeSchema.parse(req.params.code), profile(res))),
  );
  const commandLimit = rateLimit({
    windowMs: 60_000,
    limit: 120,
    keyGenerator: (_req, res) => profile(res),
    message: { error: "rateLimit" },
  });
  app.post("/api/games/:code/commands", commandLimit, (req, res) => {
    const code = codeSchema.parse(req.params.code);
    const { command, revision, requestId } = z
      .object({
        command: commandSchema,
        revision: z.number().int().nonnegative(),
        requestId: z.string().uuid(),
      })
      .parse(req.body);
    store.command(code, profile(res), command, revision, requestId);
    notify(code);
    try {
      res.json(store.view(code, profile(res)));
    } catch (error) {
      // Leaving the lobby ends the player's access, so there is no table to show.
      if (
        command.type === "leave" &&
        error instanceof GameError &&
        error.code === "forbidden"
      )
        res.json({ left: true });
      else throw error;
    }
  });
  app.get("/api/games/:code/report", (req, res) =>
    res.json(store.report(codeSchema.parse(req.params.code), profile(res))),
  );
  app.get("/api/games/:code/events", (req, res) => {
    const code = codeSchema.parse(req.params.code);
    const current = session(res);
    store.view(code, current.profileId);
    const count = [...streams.values()].reduce(
      (sum, clients) =>
        sum +
        [...clients].filter(
          (client) => client.session.profileId === current.profileId,
        ).length,
      0,
    );
    if (count >= 10) throw new GameError("rateLimit", 429);
    res.set({
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const clients = streams.get(code) ?? new Set();
    const client = { response: res, session: current };
    clients.add(client);
    streams.set(code, clients);
    res.write("retry: 3000\nevent: update\ndata: {}\n\n");
    const heartbeat = setInterval(() => {
      if (!auth.isValid(current)) {
        res.write("event: session\ndata: {}\n\n");
        res.end();
      } else if (!res.write(": keepalive\n\n")) res.end();
    }, 20_000);
    res.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(client);
      if (!clients.size) streams.delete(code);
    });
  });
  app.get("/api/reports", (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100_000)
      .parse(req.query.page ?? 0);
    res.json(store.reports(profile(res), page));
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "notFound" }));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof GameError) {
      res.locals.errorCode = error.code;
      res.status(error.status).json({ error: error.code });
      return;
    }
    if (
      error instanceof z.ZodError ||
      (error instanceof SyntaxError && "body" in error)
    ) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      res.status(413).json({ error: "invalid" });
      return;
    }
    console.error("Request failed", error);
    res.status(500).json({ error: "server" });
  };
  app.use(errors);
  return {
    app,
    // Hourly cleanup. Returns what was removed so the host can see it in the log.
    maintenance(now = Date.now()) {
      auth.pruneExpiredSessions();
      const tables = store.prune(now);
      for (const code of tables) notify(code);
      const guests = auth.pruneIdleGuests(now);
      return { tables: tables.length, guests };
    },
    closeStreams() {
      for (const clients of streams.values())
        for (const { response } of clients) response.end();
    },
  };
}
