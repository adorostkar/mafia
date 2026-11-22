import { closeSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";

export async function backupDatabase(
  sourcePath: string,
  destinationPath: string,
) {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (source === destination)
    throw new Error("The backup must use a different file.");
  const db = new DatabaseSync(source, { readOnly: true });
  let created = false;
  try {
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    closeSync(openSync(destination, "wx", 0o600));
    created = true;
    await backup(db, destination);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      if (
        copy.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
      ) {
        throw new Error("The backup did not pass SQLite's integrity check.");
      }
    } finally {
      copy.close();
    }
  } catch (error) {
    if (created) unlinkSync(destination);
    throw error;
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv[2] || process.argv.length !== 3) {
    console.error("Usage: npm run backup -- ./backups/mafia-YYYY-MM-DD.sqlite");
    process.exitCode = 1;
  } else {
    await backupDatabase(
      process.env.DATABASE_PATH ?? "./data/mafia.sqlite",
      process.argv[2],
    );
    console.log(
      `Backup saved to ${resolve(process.argv[2])}. It contains private data. Keep it secure.`,
    );
  }
}
