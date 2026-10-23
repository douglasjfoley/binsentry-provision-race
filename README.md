# Race the Route

A 90-second touchscreen game for the BinSentry booth at IPPE 2027. The player drives a feed truck from the mill to a set of farm bins and races the ProVision truck, which plans the best route before it rolls.

**Status:** Phase 2, grey-box game ready for playtesting. Final art, brand colors, audio and the full ProVision planning visual come in Phase 3.

## Setup

Needs [Node.js](https://nodejs.org) 22.18 or newer. Node runs the TypeScript tools directly, with no build step.

```bash
npm install
```

## Play it

```bash
npm run dev
```

Open the address it prints (usually http://localhost:5173). To play on an iPad on the same Wi-Fi, open the "Network" address it prints instead.

## Booth and iPad install

1. `npm run build` writes the finished game to `dist/`.
2. Serve that folder from any static web server (for a quick local one: `npm run preview`).
3. Booth PC: open it in Chrome and choose **Install Race the Route**, then run Chrome in kiosk mode.
4. iPad: open it in Safari, then **Share > Add to Home Screen**, and use Guided Access.

After one online load the game runs with the network unplugged. `public/config.json` and `public/scenarios/` are read fresh whenever the server answers, so changing them needs no rebuild.

## Booth config (`public/config.json`)

| Field | Meaning |
| --- | --- |
| `deviceId` | Name for this screen, written on every run record |
| `defaultLevel` | `quick-run`, `full-route` or `expert` (staff can override in the admin panel) |
| `scenarios` | Scenario files to load |
| `idle` | Seconds without a touch before results (`resultsSec`), a race (`raceSec`) or name entry (`setupSec`) return to the attract loop |
| `volume`, `muted` | Starting sound settings (audio arrives in Phase 3) |
| `adminPin` | 4-digit staff PIN. **Change it before the show.** |
| `leaderboardResetTime` | Local time the Today board resets |
| `ctaUrl`, `ctaQrImage` | Call-to-action link, and an optional QR code image for it |
| `leadCapture` | `light` (QR only) for v1 |

## Staff panel

Tap the top-left corner five times within 3 seconds, then enter the PIN. From there staff can switch level, set sound, reset or freeze today's board, hide a name, export every run as CSV, and see the build version and scenario checksums.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the game locally with live reload |
| `npm run build` | Type-checks and builds the installable game into `dist/` |
| `npm run solve` | Finds ProVision's best plan for every scenario and writes it into the scenario file |
| `npm run harness` | Checks that ProVision beats the best possible human run; writes `guarantee.passed` |
| `npm run replay` | Replays recorded input logs in `tests/replays/` and checks the finish times match |
| `npm test` | Runs all tests |
| `npm run typecheck` | Type-checks the code |

Each tool takes scenario or log paths as arguments, for example `node tools/solve.ts public/scenarios/full-route-monday.json`.

## Adding or changing a scenario

1. Copy a file in `public/scenarios/` and edit it, and add it to `scenarios` in `public/config.json`. The shape is defined in `src/scenario/schema.ts`. Leave `provision.plan` empty and `guarantee.passed` false.
2. Run `npm run solve`, then `npm run harness`.
3. If the harness prints `FAIL`, retune the scenario (drain rates, truck speed, bin needs or estimates) and run both again.
4. The game will not load a scenario unless the harness passed it, and refuses any scenario edited after the harness ran. Run both tools after every edit.
5. Re-record the replay logs if you changed `full-route-monday.json` (see `tools/replay.ts`).
6. All on-screen copy, including scenario names and setup lines, must pass `npm test`, which checks the brand rules (ProVision spelling, no "AI", no em dashes, no banned words).

## How ProVision wins honestly

- **One simulation, two drivers.** Both trucks run through the same fixed-step simulation (1/60 s ticks, `src/sim/`). The player sends commands by tapping; ProVision replays a precomputed list of the same commands.
- **Exhaustive solver** (`src/solver/search.ts`). Branch-and-bound search over every load mix, bin order and trip grouping, using the simulation's exact timing rules. Eight bins solve in about a second.
- **Guarantee harness** (`src/solver/harness.ts`). Simulated humans with zero decision time play perfectly on what a player can see: the estimates, plus each bin's true need once they reach it. The bar is a human who re-plans at every stop. ProVision's time plus its 3 s planning head start plus the margin must not be slower than that human's best score.
- **Hedging warning.** The harness also runs humans who pad the estimates by 10 to 25%. If one of them would beat ProVision it prints a warning; it does not fail the scenario.

## Layout

```
public/config.json   booth config
public/scenarios/    scenario JSON files (the game's only source of map, bin, feed, tuning, copy and plan data)
src/game/            the game: screens, HUD, map rendering, leaderboard, admin panel
src/scenario/        Zod schema and scenario loading
src/sim/             road graph, timing rules, simulation (shared by the game and the tools)
src/solver/          ProVision solver and guarantee harness
tools/               command-line tools (solve, harness, replay, icons)
tests/               tests and recorded replay logs
```
