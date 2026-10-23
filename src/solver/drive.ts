// Turning search results into Sim commands, for ProVision's plan and for the harness's simulated humans.
import type { Command, Scenario } from '../scenario/schema.ts';
import { initialBin, arrangeMix, TICKS_PER_SEC } from '../sim/rules.ts';
import { Sim } from '../sim/sim.ts';
import { Planner, type Action, type SearchResult, type SearchState } from './search.ts';

export const SOLVER_VERSION = '1.0.0';

/** Search state for a truck at the mill at `tick`, planning on `needs`. */
export function startState(planner: Planner, needs: number[], tick: number): SearchState {
  return {
    tick,
    node: planner.mill,
    comps: Array.from({ length: planner.s.truck.compartments }, () => ({ feed: null, tons: 0 })),
    bins: planner.s.bins.map((b, i) => {
      const bin = initialBin(b.startFill, needs[i]!);
      return bin;
    }),
    outages: 0,
  };
}

/** Search state mirroring a live Sim, with `believe(i)` as the remaining need of each bin not yet visited. */
export function stateFromSim(planner: Planner, sim: Sim, believe: (bin: number) => number): SearchState {
  return {
    tick: sim.tick,
    node: sim.node,
    comps: sim.comps.map((c) => ({ ...c })),
    bins: sim.bins.map((b, i) => (sim.revealed[i] ? { ...b } : { ...b, remaining: believe(i), complete: false })),
    outages: sim.outOfFeed,
  };
}

/** Issue the next decision (a load and/or one goto) for the truck. Returns false if there was nothing to do. */
export function issueNext(sim: Sim, planner: Planner, actions: Action[]): boolean {
  let issued = false;
  while (actions.length) {
    const a = actions.shift()!;
    if (a.type === 'load') sim.command({ cmd: 'load', mix: arrangeMix(sim.comps, a.feeds) });
    else sim.command({ cmd: 'goto', target: a.target === 'mill' ? 'mill' : planner.s.bins[a.target]!.id });
    issued = true;
    if (a.type === 'goto') break;
  }
  return issued;
}

export interface ProvisionSolution {
  plan: Command[];
  finishSec: number;
  search: SearchResult;
  /** The verified run, played back through the real Sim. */
  sim: Sim;
  searchMs: number;
}

export function solveProvision(scenario: Scenario): ProvisionSolution {
  const planner = new Planner(scenario);
  const startTick = Math.round(scenario.provision.planningSec * TICKS_PER_SEC);
  const t0 = performance.now();
  let search = planner.solve(startState(planner, scenario.bins.map((b) => b.needTons), startTick), { forbidOutage: true });
  if (!Number.isFinite(search.scoreTicks)) {
    // No plan avoids every out-of-feed event; fall back to the best plan with penalties so the problem is visible.
    search = planner.solve(startState(planner, scenario.bins.map((b) => b.needTons), startTick), { forbidOutage: false });
  }
  const searchMs = performance.now() - t0;

  // Play the actions through the Sim, recording the exact commands (load mixes depend on slot contents).
  const sim = new Sim(scenario, { startTick });
  const queue = [...search.actions];
  const plan: Command[] = [];
  while (!sim.finished && sim.tick < 60 * 60 * 10) {
    if (sim.activity === 'idle' && sim.pending === null && sim.tick >= startTick) {
      const before = sim.inputs.length;
      if (!issueNext(sim, planner, queue)) break;
      plan.push(...sim.inputs.slice(before).map((r) => r.cmd));
    }
    sim.advance();
  }
  if (!sim.finished || sim.finishTick !== search.finishTick) {
    throw new Error(
      `Solver and simulation disagree: search finish tick ${search.finishTick}, sim ${sim.finished ? sim.finishTick : 'did not finish'}`,
    );
  }
  return { plan, finishSec: (sim.finishTick - startTick) / TICKS_PER_SEC, search, sim, searchMs };
}
