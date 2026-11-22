# Mafia Table

A complete web app for a group playing Mafia together. One person hosts as the
Game Master (GM). Players use their own phones for secret roles, night choices,
and votes. The app runs the rules and saves the match.

The design uses a dark card-table theme, red/green/gold faction colors, and
self-hosted fonts. All screens, rules, errors, and announcements are available in
English and Finnish. More languages can be added with a JSON file.

## Run locally

Use **Node.js 24 or newer**.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. For phones on the same trusted network, use
`http://<your-computer-LAN-IP>:5173`. The development server forwards game requests
to the local backend. Do not expose the development server to the internet.

To run the built app:

```sh
npm run build
npm start
```

Open **http://localhost:3001**. This serves both the client and backend.
Use `HOST=0.0.0.0 npm start` only when you need to listen on other network
interfaces. Use HTTPS for internet play.

Data is saved at `data/mafia.sqlite`. Restarting the app does not erase games.
You can copy `.env.example` to `.env` to change the settings. No paid backend,
email service, API key, or external account is needed.

### Play a match

1. The GM creates a table and shares its six-character join code.
2. Between 4 and 30 players join with a name. The GM is not a player.
3. The GM suggests or edits role counts, chooses the voting style, and saves.
4. Everyone reviews **How to play**. The GM confirms this and assigns roles.
5. Players reveal their own role when it is safe. Introduction night lets Mafia
   meet and Nostradamus choose a side. Nobody attacks that night.
6. During the day, discuss and vote. The GM has 60-second speaking and 30-second
   challenge timers.
7. At night, the app prompts each role in order. Players submit choices privately.
   The GM advances the prompts and resolves the night.
8. The app applies abilities, checks for a winner, and saves the final report.

Each person needs a separate device or browser profile. Tabs in the same browser
share one identity. **Your tables** lets you return to active games. Game and
report URLs can also be bookmarked.

This is an in-person companion app. It does not include voice or video chat.
For remote play, use a separate call and keep private role screens out of screen
sharing.

## The rules

Mafia has many local versions. This app has one explicit house ruleset,
**`mafia-table-1`**, inspired by social Mafia and Godfather-style role games.
It is not an official Iranian, Hungarian, or Finnish tournament ruleset.
The in-app rulebook describes the rules that this version actually runs.

### Roles

| Faction              | Role           | Ability                                                                                                                                                                                    |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mafia / red          | Godfather      | Leads the Mafia shot, appears Citizen to Detective, and has one vest. Once per game, an exact role guess can replace the shot and bypass all defenses. A wrong guess wastes it.            |
| Mafia / red          | Saul Goodman   | After an original Mafia member dies, try once to recruit a Simple Citizen. The attempt replaces that night's Mafia attack, even if it fails.                                               |
| Mafia / red          | Matador        | Block a non-Mafia player's night ability. Cannot choose the same player on consecutive nights.                                                                                             |
| Mafia / red          | Terrorist      | When voted out, choose one living player to take out too, or pass. Neither can be revived. Other causes of death do not trigger this ability.                                              |
| Mafia / red          | Simple Mafia   | Meet the team at night and propose an attack target.                                                                                                                                       |
| Citizen / green      | Doctor         | Stop ordinary night bullets for one player. One self-heal. Cannot choose the same player on consecutive nights.                                                                            |
| Citizen / green      | Detective      | Learn a player's apparent faction in a private result at dawn. Godfather appears Citizen.                                                                                                  |
| Citizen / green      | Sniper         | Two night shots and one vest. Shooting a Citizen kills the Sniper instead. This also applies to Citizen-aligned Nostradamus.                                                               |
| Citizen / green      | Gunman         | Give out two loaded guns in total and any number of blanks, at most one gun per night. The recipient cannot see the ammunition.                                                            |
| Citizen / green      | Constantine    | Revive one previously eliminated player, once per game. Cannot revive players who left or victims of Sixth Sense or Terrorist.                                                             |
| Citizen / green      | Simple Citizen | Discuss and vote. Can use a gun received from Gunman.                                                                                                                                      |
| Third Party / yellow | Zodiac         | One vest and one night attack that ignores all defenses. Wins alive among the last two players.                                                                                            |
| Third Party / yellow | Nostradamus    | Inspect three players on introduction night, then choose a secret winning side. Godfather does not count as Mafia. Three apparent Mafia forces a Mafia choice. Immune to ordinary bullets. |

Each special role has a limit of one. Simple Mafia and Simple Citizens can fill
the remaining seats. There must be one role per player, at least one Mafia and
one Citizen, and fewer than half the players may start as Mafia. Suggested roles
are a starting point, not a promise of perfect balance.

### Day and night

The GM chooses either one-round majority voting or two-round voting. In the
two-round mode, the most-nominated player or tied players defend themselves
before the final ballot. Players cannot vote for themselves. A final elimination
needs **more than half of all living players' votes**. Abstentions still count
toward the number of living players. A tie or no majority eliminates no one.
Each day must have a completed vote before night starts.

Living Mafia members see their teammates and proposed targets only during the
Mafia wake window. A non-empty Godfather choice takes priority. Without it, a
single target with the most Mafia votes is attacked. A tie means no attack.

Night choices are locked when submitted. Night resolution follows this order:
blocks, recruitment, healing, Mafia attack, Sniper, Zodiac, revival,
investigations, then gun delivery. A player alive when resolution starts still
acts if killed that night. Investigation results arrive privately at dawn.

Healing stops an ordinary night bullet before a vest is used. Godfather,
Sniper, and Zodiac each start with one vest. Nostradamus ignores ordinary
bullets. Zodiac and a correct Sixth Sense guess bypass both healing and vests.
Sixth Sense also prevents revival. Revival does not restore used powers or
ammunition. A blocked limited-use ability does not spend its use or ammunition.

A player can hold one gun. They can fire it once during day discussion, not
during a vote or defense. A blank does nothing. A loaded gun can be stopped by
a vest or Nostradamus's bullet immunity.

The GM must explicitly skip missing night responses or votes. They become
passes or abstentions. Skipping Nostradamus before a side is chosen defaults
to Citizen, unless the prediction requires Mafia. The GM can skip an unanswered
Terrorist last move. There are no hidden GM overrides for roles, votes, or wins.

### Winning and leaving

Citizens win when no Mafia or Zodiac remains. Mafia wins when its living count
is at least the count of all other living players, but only after Zodiac is gone.
Zodiac wins alive among the last two. Nostradamus wins with the chosen side,
even if eliminated, but does not change Mafia's head count.

Players who leave cannot win. Leaving is paused during voting and defense.
Leaving the lobby frees a seat; that profile can rejoin while the lobby is open.
A player who leaves an active match cannot take the seat back.

If no one remains alive, or 50 regular nights pass without an earlier win, the
match is a draw. A GM can cancel a table that cannot continue. Cancelled games
have reports but do not affect wins, losses, or player statistics.

## Accounts and recovery

Playing as a guest needs no sign-up. Creating an account keeps that guest
profile's games and gives it a username and password. Signing in on another
device can also move that device's guest history into the account.

Two profiles that participated in the same match cannot be merged. This avoids
turning two seats into one player. Leave active guest games and sign in without
moving the guest history in that case.

Passwords must be 15–128 characters. The server stores salted **scrypt** hashes,
not passwords. Its settings are `N=131072, r=8, p=1`, with at most two password
hash operations running at once. Allow enough server memory for this; 1 GB is a
reasonable starting point for a small host.

Account creation shows a random **one-time recovery code**. Save it in a password
manager or download it from the dialog. It is hidden until revealed. There is no
email reset service.

- Recovery sets a new password, revokes old sessions, and gives a new recovery
  code. The old code no longer works. You then sign in.
- Changing a password or replacing a recovery code signs other devices out.
- **Your profile** shows signed-in sessions and lets you revoke another device.
- Account cookies expire after 30 days. Guest cookies expire after one year.
- Losing a guest cookie without first creating an account loses access to that
  guest history. Without a password or recovery code, an account cannot be
  recovered through the app.

You can download your profile and game data as JSON. You can also delete your
profile after leaving active games or cancelling tables you host. Account
deletion removes credentials, sessions, and player names. Shared match facts
remain anonymous so other players keep their reports. Backups may still contain
older data until the host removes them.

## Reports and privacy

Reports show original and final roles, winning sides, votes, night choices,
results, and the match timeline. Only participants and the GM can view them.
Finished **and cancelled** matches reveal these facts to those participants.
The join screen explains this before a player enters.

Statistics come from saved match records:

- Games played, wins, win rate, and original role history.
- First-day eliminations from voting or the Terrorist's last move. Later revival
  does not erase the first-day record.
- Sniper shots and hits. Passes and blocked shots are not counted as shots.
  Protected shots and friendly-fire attempts are shots, but not hits.
- GM-only games and cancelled games do not count as games played.

History uses pages of 20 matches. Player statistics cover the whole history,
not just the current page.

Roles are shuffled with server-side cryptographic randomness. A player's
response does not contain other hidden roles. The GM sees all roles and night
choices. A voted-out Terrorist is publicly revealed for the last move. All roles
are visible when the game ends.

This is **not end-to-end encryption**. The GM and server operator can access
game secrets. Use a trusted host and do not put sensitive personal information
in player names.

## Accessibility and slow connections

The app uses native form controls, headings, landmarks, keyboard focus states,
and a skip link. Touch controls are at least 48 pixels high. Faction labels
always accompany their colors. High-contrast, forced-colors, and reduced-motion
styles are included.

Private roles and results need a deliberate reveal. Switching away from the page
hides them again. Use headphones: a screen reader can speak a secret aloud.
Private night prompts and public game changes use live regions.

Timers announce their start, ten seconds remaining, and completion, without
reading every tick. An optional tone needs a user gesture to enable audio.
Browsers may pause audio and scripts in the background. Keep the page open for
timer alerts. The saved server deadline, not the phone's wall clock, determines
the countdown.

Live updates use small Server-Sent Events (SSE) notifications. Each client then
fetches its own private state. When streaming fails, polling runs every ten
seconds. Returning to the page fetches the current state too.

Disconnected controls pause. Actions are not queued for later play. A request
has a unique ID; retrying the same uncertain action uses the same ID so it cannot
apply twice. GM changes also check the latest game revision. Player actions and
votes check their specific day, night window, or ballot.

Fonts are served by this app, with their licenses at `/font-licenses.txt`.
There are no remote font requests, image services,
analytics scripts, or tracking cookies. Hashed static files can be cached.
Private responses and HTML are not cached. This is not an offline-play app.
Use a current browser; the client uses native `EventSource`, `dialog`, `Intl`,
and `AbortSignal` features.

Automated accessibility checks are included. They are not a certification.
Before a public launch, also try VoiceOver on iOS, TalkBack on Android, and NVDA
on desktop, with both languages and real headphone use.

## Add a language

1. Copy `src/locales/en.json` to a new file, such as `src/locales/hu.json`.
2. Set `meta.code` to the language code, `meta.nativeName` to its name in that
   language, and `meta.direction` to `ltr` or `rtl`.
3. Translate all text. Keep keys and `{{variables}}` unchanged.
4. Add the plural forms required by that language. English uses `_one` and
   `_other`; some languages need `_zero`, `_two`, `_few`, or `_many` too.
5. Set `meta.enabled` to `true`. Run `npm test` and `npm run build`.

The language menu discovers enabled files automatically. There is no component
or TypeScript language list to edit. Set `enabled` to `false` while a translation
is unfinished. Dates, numbers, and lists use `Intl`; plural messages use
i18next. English is the fallback language.

`src/i18n.test.ts` checks enabled catalogs for missing text, changed variables,
and required plural forms. Keep whole sentences in the catalogs rather than
joining English words in components. Check font coverage, long labels,
right-to-left layout, and screen-reader output when adding a new language.
Translations should get a fluent-speaker review before public use.

## Stack and architecture

| Part         | Choice                                              | Why                                                        |
| ------------ | --------------------------------------------------- | ---------------------------------------------------------- |
| Client       | React, TypeScript, Vite                             | A small client with no need for server-rendered game pages |
| Backend      | Node.js, Express                                    | One process handles commands and live connections          |
| Database     | SQLite with WAL through `node:sqlite`               | Durable storage without a hosted database account          |
| Live updates | SSE plus normal HTTP                                | Small messages, easy reconnect, and a polling fallback     |
| Validation   | Zod                                                 | Check requests and stored data before use                  |
| Languages    | i18next, JSON catalogs, `Intl`                      | Full sentences, variables, plurals, and locale formatting  |
| Checks       | Vitest, Testing Library, axe-core, ESLint, Prettier | Game rules, privacy, accounts, UI, and catalog checks      |

```text
React client
  | commands over HTTP       ^ caller-specific state over HTTP
  v                          |
Express: session, origin, input, and rate checks
  |
  +--> AuthStore: passwords, sessions, recovery, deletion
  |
  +--> GameStore: access, transactions, private views, reports
         |
         +--> rules: complete state transitions and win checks
         |
         +--> SQLite: game state and history saved together

After a committed change:
SSE sends an empty "update" event
Each client fetches its own private view
```

The game module owns the rule and privacy decisions. The client does not decide
whether a target is legal or whether a faction has won. Commands either commit
in one transaction or leave the match unchanged.

| File                 | Responsibility                                    |
| -------------------- | ------------------------------------------------- |
| `shared/game.ts`     | Roles and shared request/view types               |
| `server/model.ts`    | Stored game and player state                      |
| `server/rules.ts`    | Actions, ballots, abilities, and victory checks   |
| `server/game.ts`     | Save/load, private views, history, and statistics |
| `server/auth.ts`     | Accounts, session tokens, recovery, and deletion  |
| `server/app.ts`      | HTTP routes, request checks, limits, and SSE      |
| `server/database.ts` | Schema and versioned migrations                   |
| `server/backup.ts`   | Online, checked database backups                  |
| `src/useGame.ts`     | Live state, reconnect, and safe command retries   |
| `src/GameTable.tsx`  | Lobby and GM/player game flows                    |
| `src/Account.tsx`    | Sign-in, recovery, sessions, and privacy controls |
| `src/Reports.tsx`    | Personal statistics and match reports             |
| `src/locales/*.json` | UI, rules, prompts, and announcements             |

### Data model

| Table              | Stores                                                                        |
| ------------------ | ----------------------------------------------------------------------------- |
| `profiles`         | Stable player identities                                                      |
| `accounts`         | Unique usernames and password/recovery hashes                                 |
| `sessions`         | Hashed random tokens, profile links, and expiry/usage times                   |
| `games`            | Join codes, GM links, phase, day, rules version, timer, winner, and state     |
| `players`          | Membership, name, original/current role, life state, ability uses, and result |
| `actions`          | Actor, target list, night/day, optional role guess or ammunition, and outcome |
| `votes`            | Ballot, voter, target or abstention, day, and round                           |
| `private_notices`  | Player-only investigation, prediction, recruitment, and gun results           |
| `public_events`    | The match timeline                                                            |
| `events`           | The command history                                                           |
| `command_receipts` | Request IDs and payload hashes that prevent duplicate changes                 |

Foreign keys, unique seat/action/vote constraints, and transactions protect
stored state. Statistics are derived from records instead of separate counters.
Game records are kept until the host removes them; the app does not silently
expire match history. Expired sessions are pruned on startup and hourly.

### HTTP interface

Start with `GET /api/me` to create or resume a cookie session. Write requests need
JSON and `X-Mafia-Client: 1`. Cookies are HTTP-only and SameSite=Strict; production
cookies also require HTTPS. Session tokens are stored only as hashes.

| Method     | Path                                                  | Purpose                                 |
| ---------- | ----------------------------------------------------- | --------------------------------------- |
| GET        | `/healthz`                                            | Server/database readiness               |
| GET        | `/api/me`                                             | Current identity                        |
| POST       | `/api/auth/register`, `/login`, `/logout`, `/recover` | Account lifecycle                       |
| POST       | `/api/account/password`, `/recovery`, `/delete`       | Protected account changes               |
| GET        | `/api/account/sessions`, `/export`                    | Sessions and data download              |
| POST       | `/api/account/sessions/revoke`                        | Revoke another device                   |
| GET / POST | `/api/games`                                          | List active games / create a table      |
| POST       | `/api/games/:code/join`                               | Join with `{ "name": "Aino" }`          |
| GET        | `/api/games/:code`                                    | Caller-specific game view               |
| POST       | `/api/games/:code/commands`                           | Apply a typed game command              |
| GET        | `/api/games/:code/events`                             | Private-access SSE notifications        |
| GET        | `/api/games/:code/report`                             | Participant-only finished report        |
| GET        | `/api/reports?page=0`                                 | Personal statistics and match summaries |

A command request looks like this:

```json
{
  "requestId": "f402097b-5eb0-42ed-adf6-6f0b514ed9e7",
  "revision": 6,
  "command": { "type": "start" }
}
```

See the `Command` union in `shared/game.ts` for all command shapes. Failures use
an error code, such as `{ "error": "stale" }`, which the client translates.
Public SSE messages contain no names, roles, targets, or votes. A revoked or
expired session closes its stream and removes the game view from the client.

## Deploy

Run **one long-lived Node process** with a persistent, local disk. A read-only
serverless function, multiple app replicas, and a network-mounted SQLite file
are not supported. For larger deployments, move storage to Postgres and use a
shared notification channel between processes.

```sh
npm ci
npm run build
NODE_ENV=production \
PUBLIC_ORIGIN=https://mafia.example.com \
DATABASE_PATH=/var/lib/mafia/mafia.sqlite \
PORT=3001 \
npm start
```

The data directory must be writable by the app's OS user. Run as a dedicated,
non-root user. New database and backup files use private permissions.

Put an HTTPS reverse proxy in front of the app. `PUBLIC_ORIGIN` must exactly match
the browser's origin, with no path or trailing slash. Production startup refuses
a missing or non-HTTPS public origin.

For example, a Caddy site on the same host can use:

```caddyfile
mafia.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3001 {
        flush_interval -1
    }
}
```

Use your own domain and point it to the host. Keep the backend port private.
Turn off buffering for SSE and allow long-lived connections. Compress static
HTML, CSS, and JavaScript at the proxy. Do not batch live SSE events.

Set `TRUST_PROXY` only for your actual proxy addresses or CIDRs. For a loopback
proxy, `TRUST_PROXY=loopback` is suitable. Never trust arbitrary forwarded
headers. Without this setting, limits see the directly connected peer's IP.
Limit settings allow a group to share one network, but are not a replacement for
host-level abuse controls and monitoring.

### Docker

`Dockerfile` builds a non-root image. `compose.yaml` adds a persistent data volume,
a read-only root filesystem, and a local-only port. An external HTTPS proxy is
still needed.

```sh
PUBLIC_ORIGIN=https://mafia.example.com docker compose up --build -d
```

Configure `TRUST_PROXY` for the source address the app actually sees from your
proxy. Do not assume the Docker gateway is a loopback address.

The image checks `/healthz`. Watch logs, disk space, backup jobs, and health checks
on the host. Test the image on a running Docker engine before deployment.

### Backup, restore, and upgrades

Create a consistent backup without stopping the app:

```sh
npm run backup -- ./backups/mafia-2026-01-01.sqlite
```

The command uses SQLite's online backup API and checks the result. It refuses to
overwrite a file. Set `DATABASE_PATH` or use `.env` if your database is elsewhere.
In a container, run the same command against the mounted data path and a writable
backup destination. Backups contain game secrets, account hashes, and player
names. Protect them and follow a retention schedule.

To restore, stop the app first. Move the current database and any matching
`-wal` and `-shm` files to a safe archive. Copy the backup to `DATABASE_PATH`, set
its owner and mode to the app user and `600`, then start the app. Open a known
game and report to check the restored data. Do not combine an old WAL file with
a restored database.

**Do not copy only the main database file while the app is writing.** Use the
backup command or stop the app cleanly first.

Back up before each upgrade. Schema migrations run in a transaction on startup,
and databases from a newer app version are rejected. The migration from the
original GM-led version keeps profiles, sessions, finished reports, and choices.
Old finished reports are marked `legacy-gm-led`.

Finish old games before upgrading. If an old game was left in progress, its
history is kept and gameplay is paused. Its GM can cancel it and start a new
table. New abilities are not silently applied to an old match.

## Development checks

```sh
npm test
npm run build
npm run lint
npm run format:check
```

Use `npm run format` to apply the existing formatter. Tests cover role limits,
all named role abilities, private state, votes, win conditions, persistence,
migrations, live events, recovery, account deletion, report access, backups,
translations, and keyboard/screen-reader-friendly controls.

DOM accessibility checks use axe-core. They skip color contrast because jsdom
does not lay out the page. Use a real browser audit for contrast and mobile
layout, and actual assistive technology for spoken behavior.

### References

These sources informed the rules and account/localization choices. The app's
own rulebook takes precedence when a game variant differs.

- [VITNA: Godfather scenario](https://vitna.ir/academy/mafia_godfather_scenario/index.html)
- [OWASP: Password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP: Account recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [i18next: Plural forms](https://www.i18next.com/translation-function/plurals)
