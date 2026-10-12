# Matopeli

A Nokia 3310 that runs in your browser: the phone OS, its menus and apps, Snake II on a 32 KB Rust/WebAssembly engine, and real SMS between browsers.

- **The whole phone works.** Boot, idle screen, menu, Messages, Call register, Tones, Calculator, Reminders, Names and two games, all driven by the 3310's own keys.
- **Snake II runs on real game logic.** The rules live in a dependency-free Rust crate compiled to a 32 KB `engine.wasm`, covered by 22 unit tests.
- **Offline first.** Installable PWA. Without the SMS backend the phone shows NO SIGNAL and everything else keeps working.

**Play it:** https://matopeli-ten.vercel.app

![Snake II on the 3310](docs/shot-gameplay.png)

| Start screen | Game over | Phone menu |
|---|---|---|
| ![Start](docs/shot-start.png) | ![Game over](docs/shot-gameover.png) | ![Phone menu](docs/shot-mobile.png) |

## Run it in 30 seconds

```sh
npm install
npm run dev
```

Open http://localhost:4321. The phone boots to its idle screen. Press <kbd>Enter</kbd> or tap any key to wake it, then Navi (or <kbd>Enter</kbd>) to open the menu. Games → Snake II starts the game.

You do not need Rust to run it: the compiled `public/engine.wasm` is committed. Rust is only for changing the game engine (see [Change the game engine](#change-the-game-engine)).

## Proof

The SMS backend's own end-to-end check, run against a local worker (`cd worker && npm run smoke`):

```text
step 1 :: base http://127.0.0.1:8787
PASS step 1 base url
PASS step 2 register A=+212612000164 B=+212612000165
PASS step 3 ws open for B
PASS step 4 send A->B accepted id=f666c160-03a3-42b5-bd88-0e398e4565b0 status=delivered
PASS step 5 B received message on ws
PASS step 6 A outbox shows delivered
PASS step 7a send A->C queued while offline
PASS step 7b queued push arrived on C ws
PASS step 7c A outbox shows delivered after push
RESULT all steps passed
```

The browser suites drive the real phone in Chromium:

| Suite | Checks | What it proves |
|---|---|---|
| `test:e2e` | 31 | Start, pause, restart, level picker, typed level, LCD settings, high scores, clean console |
| `test:state` | 23 | Game state machine through a dev-only seam: eating, pause, level-up, touch swipe |
| `test:offline` | 6 | Loads online, cuts the network, reloads, starts a game |
| `test:os` | 34 | Menu, every app, keypad navigation, game ↔ phone handoff, live SMS between two phones |
| `cargo test` | 22 | Engine rules: walls, wrap-around, growth, bonus, levels, board cleared |

## What's on the phone

| Menu | What it does |
|---|---|
| Messages | Write, Inbox, Sent items. Real SMS between browsers, delivered live or queued until the other phone connects. A composed ringtone can be attached and plays on the receiver. |
| Call register | Dialled, received and missed lists. Calling a contact from Names starts a simulated call with a timer. |
| Tones | Ringing tone, message alert, keypad tones, vibrating alert, and a ringtone Composer. |
| Settings | Sound, sound style (Classic, Soft, Retro), vibration, screen effects, theme (navy or silver cover). Saved in the browser. |
| Games | Snake II and Pairs II (memory). |
| Calculator | `+ - * /` with operator precedence, typed on the keypad. |
| Reminders | A reminder list and a clock alarm. |
| Names | Contacts; select one to call it. |

## Controls

The face has the 3310's keys: **C**, **Navi** (the wide key under the screen), two **scroll keys**, and the 12-key keypad. A keyboard works too.

| Key | On a phone screen | In Snake II |
|---|---|---|
| Navi / <kbd>Enter</kbd> | Select | Start; pause while playing; resume, continue or restart from a banner |
| <kbd>C</kbd> / <kbd>Esc</kbd> | Back | Pause while playing; on the pause, start or game-over screen, back to the Games menu |
| Scroll keys / <kbd>↑</kbd> <kbd>↓</kbd> | Move in a list | Steer up or down |
| <kbd>2</kbd> <kbd>8</kbd> | Move in a list | Steer up or down |
| <kbd>4</kbd> <kbd>6</kbd> | | Steer left or right |
| <kbd>5</kbd> | Select | Continue or restart from the pause, level or game-over screen |
| <kbd>1</kbd>–<kbd>9</kbd> | Type, on screens that take typing | Pick the start level |
| <kbd>#</kbd> | Leave the phone for the Snake II screen | Open the phone menu and pause the game |
| <kbd>Space</kbd> | | Pause or resume |
| Swipe on the screen | | Steer |

Screens that take typing (writing a message, Calculator, the Names and Reminders forms) keep the digits. Every other list uses 2, 8 and 5 to move and select. Any key press lights the backlight for 6 seconds.

### Snake II rules

| Rule | Value |
|---|---|
| Food per maze | 5 |
| Mazes | 9 layouts, repeating while the level keeps rising |
| Edges | Wrap around; only maze walls and your own tail kill |
| Length | Carried into the next maze |
| Bonus bug | 2×2 cells, pays 20 + time left, disappears quickly |
| Board cleared | Filling the whole board ends the run as a win |
| High scores | Top 3, stored in the browser |

## Prerequisites

| Tool | Version | Needed for | Check |
|---|---|---|---|
| Node.js | 22.12 or newer | Everything | `node --version` |
| Rust | 1.95.0 with target `wasm32-unknown-unknown`, pinned in `rust-toolchain.toml` | Changing the engine only | `rustc --version` |
| Playwright Chromium | Matches the installed `playwright` package | Browser tests only | `npx playwright install chromium` |

## Real SMS locally

The phone talks to a Cloudflare Worker in `worker/`. D1 stores SIMs and messages; a Durable Object holds each phone's WebSocket.

Start the worker:

```sh
cd worker
npm install
npx wrangler d1 execute matopeli_os --local --file schema.sql
npm run dev
```

It listens on http://127.0.0.1:8787. In a second terminal, from the repository root, build the site and serve it:

```sh
PUBLIC_OS_API=http://127.0.0.1:8787 npm run build
npm run preview
```

Open http://localhost:4321 in two browser profiles, or a normal and a private window. Each gets its own number, shown in Messages → Inbox. Write a message from one to the other's number.

## Tests

The browser suites need running servers. Start each in its own terminal:

| Server | Command | Used by |
|---|---|---|
| SMS worker | `cd worker && npm run dev` | `test:os` |
| Production preview on 4321 | `PUBLIC_OS_API=http://127.0.0.1:8787 npm run build && npm run preview -- --port 4321` | `test:e2e`, `test:offline`, `test:os` |
| Dev server on 4322 | `npm run dev -- --port 4322` | `test:state` |

Then run:

```sh
cargo test --manifest-path engine/Cargo.toml
npx tsc --noEmit
npx astro check
BASE=http://localhost:4321 npm run test:e2e
BASE=http://localhost:4321 npm run test:offline
BASE=http://localhost:4321 npm run test:os
BASE=http://localhost:4322 npm run test:state
```

`test:state` needs the dev server because it reads the game through `window.__matopeli`, a read-only seam that exists only in dev builds and is compiled out of production.

On a machine without Google Chrome, prefix the browser suites with `CI=1` so they use Playwright's own Chromium.

## How it works

```text
engine/src/lib.rs         Rust game rules
      │  cargo build --target wasm32-unknown-unknown
      ▼
public/engine.wasm        32 KB, no dependencies, committed
      │  loaded by
      ▼
src/scripts/snake.ts      Snake II rendering, input and sound
src/os/                   the phone OS: shell, apps, SMS client
src/pages/index.astro     the 3310 face (Astro 6, Tailwind 4)
      │  HTTPS + WebSocket
      ▼
worker/                   Cloudflare Worker: D1 + Durable Object
```

| Path | Role |
|---|---|
| `src/os/os.ts` | Phone shell: boot, idle, menu, status bar, key routing, backlight |
| `src/os/events.ts` | The only channel between the game and the phone (typed events) |
| `src/os/apps/` | One file per app; each returns an `OsApp` |
| `src/os/sms.ts`, `src/os/net.ts` | The Messages app and the SIM and WebSocket client |
| `src/scripts/snake.ts` | Snake II front end over the engine |
| `scripts/gen-sw.mjs` | Writes the offline service worker after each build |
| `worker/src/worker.ts`, `worker/src/presence.ts` | SMS API and live delivery |

The front end talks to the engine through plain integer exports, with no bindings generator and no glue library:

| Export | Returns |
|---|---|
| `snake_tick()` | `0` nothing · `1` ate · `2` bonus · `3` died · `4` level up · `5` board cleared |
| `snake_state()` | `0` ready · `1` running · `2` paused · `3` over · `4` won |
| `snake_cause()` | `0` none · `1` wall · `2` self |

A phone app is an object with `mount`, `unmount` and `onKey`. Give it `acceptsDigits` returning `true` while it takes typed input; otherwise the shell turns 2, 8 and 5 into up, down and select for it.

## Offline

`npm run build` runs `scripts/gen-sw.mjs`, which writes `dist/sw.js` listing the exact hashed files of that build.

| Request | Strategy |
|---|---|
| Page navigation | Network first, cached copy when offline |
| Hashed assets (JS, CSS, WASM) | Cache first |
| Anything else | Not cached |

Only successful same-origin responses are stored, and only caches named `matopeli-*` are ever deleted. `test:offline` proves it end to end.

## Change the game engine

```sh
cd engine
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/engine.wasm ../public/engine.wasm
```

The release build is byte-identical for the pinned toolchain. CI rebuilds it and fails when the committed `public/engine.wasm` differs. Never edit the binary by hand.

## Deploy

| Part | How |
|---|---|
| Site | Any static host. `npm run build` writes `dist/`. Set `PUBLIC_OS_API` to the worker's URL at build time, or the phone shows NO SIGNAL. |
| Worker | From `worker/`: `npx wrangler d1 create matopeli_os`, put the printed `database_id` in `wrangler.toml` (it is `local` today), run `npx wrangler d1 execute matopeli_os --remote --file schema.sql`, then `npx wrangler deploy`. |

## Data and privacy

| Data | Where it lives |
|---|---|
| Scores, settings, contacts, reminders, call register | Your browser's `localStorage`; never sent anywhere |
| Your phone number and its secret token | `localStorage`, and the `sims` table in D1 |
| Messages | The `messages` table in D1: sender, recipient, body, status and time. Nothing deletes them. |

Numbers are handed out in sequence (`+212612000001`, `+212612000002`, …). They are not real phone numbers and cannot reach a real phone.

## Limitations

- The live site has no SMS backend deployed, so it shows NO SIGNAL. Messaging works only with a worker you run or deploy.
- The SIM token travels in the WebSocket URL (`/ws?token=…`), where proxies and logs can record it. Move it into the first WebSocket message before running the worker for real users.
- The worker answers any origin (`Access-Control-Allow-Origin: *`).
- CI runs the engine tests, type checks, the build, `test:e2e`, `test:offline` and `test:state`. It does not run `test:os` or the worker smoke test.
- Full playthroughs of every level are not automated; level changes are covered by engine tests and a scripted level 1 → 2 run.
- Restoring the page from the back/forward cache starts a fresh game, not the exact mid-run state.
- Sound starts after your first tap or key press (browser policy). Vibration works only on phones that support it.
- In a normal browser tab on a phone held sideways, the page scrolls. Installed as an app, it stays in portrait.

## Troubleshooting

**The phone says NO SIGNAL.**
The site has no worker to reach. Start one (`cd worker && npm run dev`). `npm run dev` connects to it at http://127.0.0.1:8787 on its own. A production build connects only when built with `PUBLIC_OS_API`, for example `PUBLIC_OS_API=http://127.0.0.1:8787 npm run build`; without it the phone stays offline and makes no network requests.

**The worker fails with `no such table: sims`.**
The local database is empty. From `worker/`, run `npx wrangler d1 execute matopeli_os --local --file schema.sql`.

**A browser test fails with `browserType.launch: Executable doesn't exist`.**
Playwright's Chromium is missing or older than the installed `playwright` package. Run `npx playwright install chromium`.

**`test:state` fails at once with a `TimeoutError` on `waitForFunction`.**
It is pointed at a production build or at the wrong port. When 4322 is taken, Astro prints `Port 4322 is in use, trying another one...` and starts on the next free port. Pass that port in `BASE`.

**CI fails on "committed wasm matches engine source".**
The engine source changed without rebuilding the binary. Follow [Change the game engine](#change-the-game-engine) and commit the new `public/engine.wasm`.

**No sound.**
Browsers block audio until the first user gesture. Press any key, then check Menu → Settings → Sound.

## License

MIT, see [LICENSE](LICENSE).
