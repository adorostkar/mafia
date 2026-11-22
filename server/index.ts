import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import express from "express";
import { z } from "zod";
import { openDatabase } from "./database.js";
import { createApp } from "./app.js";
import { createResendMailer } from "./email.js";

process.umask(0o077);
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const production = process.env.NODE_ENV === "production";
const publicOrigin = process.env.PUBLIC_ORIGIN?.trim() || undefined;
if (publicOrigin) {
  const url = new URL(publicOrigin);
  if (
    url.origin !== publicOrigin ||
    !["http:", "https:"].includes(url.protocol) ||
    (production && url.protocol !== "https:")
  ) {
    throw new Error(
      "PUBLIC_ORIGIN must be an exact origin without a path. Production requires HTTPS.",
    );
  }
} else if (production) {
  throw new Error(
    "Set PUBLIC_ORIGIN to the public HTTPS origin before starting in production.",
  );
}
const path = process.env.DATABASE_PATH ?? "./data/mafia.sqlite";
mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
const db = openDatabase(path);
const { app, closeStreams, maintenance } = createApp(db, {
  secureCookies: production,
  publicOrigin,
  email: createResendMailer(process.env),
  trustProxy: process.env.TRUST_PROXY?.split(",")
    .map((address) => address.trim())
    .filter(Boolean),
});
maintenance();
const cleanup = setInterval(maintenance, 60 * 60_000);
cleanup.unref();
app.use(
  "/assets",
  express.static(resolve("dist/assets"), {
    immutable: true,
    maxAge: "1y",
    index: false,
  }),
);
app.get(["/", "/index.html"], (_req, res) => {
  res.set("Cache-Control", "no-store").sendFile(resolve("dist/index.html"));
});
app.use(express.static(resolve("dist"), { index: false }));
app.use((_req, res) => res.status(404).json({ error: "notFound" }));
const server = app.listen(port, host, () =>
  console.log(`Mafia Table listening on port ${port}`),
);
server.on("error", (error) => {
  clearInterval(cleanup);
  db.close();
  console.error("Could not start Mafia Table", error);
  process.exitCode = 1;
});
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(cleanup);
  closeStreams();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => {
    server.closeAllConnections();
  }, 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
