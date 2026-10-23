# Race the Route

A 90-second touchscreen game for the BinSentry booth at IPPE 2027. The player drives a feed truck from the mill to a set of farm bins and races the ProVision truck, which plans the best route before it rolls.

**Status:** Phase 1 (simulation, solver, guarantee harness, tests). The playable game arrives in Phase 2.

## Setup

Needs [Node.js](https://nodejs.org) 22.18 or newer. Node runs the TypeScript tools directly, with no build step.

```bash
npm install
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run solve` | Finds ProVision's best plan for every scenario and writes it into the scenario file |
| `npm run harness` | Checks that ProVision beats the best possible human run; writes `guarantee.passed` |
| `npm run replay` | Replays recorded input logs in `tests/replays/` and checks the finish times match |
| `npm test` | Runs all tests |
| `npm run typecheck` | Type-checks the code |

Each tool takes scenario or log paths as arguments, for example `node tools/solve.ts scenarios/full-route-monday.json`.

## Adding or changing a scenario

1. Copy a file in `scenarios/` and edit it. The shape is defined in `src/scenario/schema.ts`. Leave `provision.plan` empty and `guarantee.passed` false.
2. Run `npm run solve`, then `npm run harness`.
3. If the harness prints `FAIL`, retune the scenario (drain rates, truck speed, bin needs or estimates) and run both again.
4. The game will not load a scenario unless the harness passed it, and refuses any scenario edited after the harness ran. Run both tools after every edit.
5. Re-record the replay logs if you changed `full-route-monday.json` (see `tools/replay.ts`).

## How ProVision wins honestly

- **One simulation, two drivers.** Both trucks run through the same fixed-step simulation (1/60 s ticks, `src/sim/`). The player sends commands by tapping; ProVision replays a precomputed list of the same commands.
- **Exhaustive solver** (`src/solver/search.ts`). Branch-and-bound search over every load mix, bin order and trip grouping, using the simulation's exact timing rules. Eight bins solve in about a second.
- **Guarantee harness** (`src/solver/harness.ts`). Simulated humans with zero decision time play perfectly on what a player can see: the estimates, plus each bin's true need once they reach it. The bar is a human who re-plans at every stop. ProVision's time plus its 3 s planning head start plus the margin must not be slower than that human's best score.
- **Hedging warning.** The harness also runs humans who pad the estimates by 10 to 25%. If one of them would beat ProVision it prints a warning; it does not fail the scenario.

## Layout

```
scenarios/        scenario JSON files (the game's only source of map, bin, feed, tuning, copy and plan data)
src/scenario/     Zod schema and scenario loading
src/sim/          road graph, timing rules, simulation
src/solver/       ProVision solver and guarantee harness
tools/            command-line tools (solve, harness, replay)
tests/            tests and recorded replay logs
```
