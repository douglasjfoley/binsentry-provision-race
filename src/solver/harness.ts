// Guarantee harness: the best possible human run, played through the real Sim against true needs.
//
// A simulated human has zero decision time and plays perfectly on what it can see:
//   - bins not yet visited are planned on an estimate (the shown number, optionally padded as a hedge)
//   - a visited bin's true need is known from then on
// "adaptive" humans re-plan optimally at every stop, using everything revealed so far.
// "static" is the brief's literal harness: one plan on estimates, followed as far as it still makes sense,
// then an optimal recovery once the plan runs out.
// Each policy has a role:
//   bar       the guarantee: bestHumanSec is the best of these (plans on the estimates exactly as shown)
//   warning   hedging humans who pad the estimates; reported, and flagged if they would beat ProVision
//   reference the oracle (a human who somehow knows the true needs): the run ProVision's measured data buys
import type { Scenario } from '../scenario/schema.ts';
import { TICKS_PER_SEC } from '../sim/rules.ts';
import { Sim } from '../sim/sim.ts';
import { issueNext, stateFromSim } from './drive.ts';
import { Planner, type Action } from './search.ts';

export interface HumanPolicy {
  name: string;
  /** Padding applied to shown estimates, e.g. 0.1 plans for 10% more than shown. */
  hedge: number;
  mode: 'adaptive' | 'static' | 'oracle';
  role: 'bar' | 'warning' | 'reference';
}

export const HUMAN_POLICIES: HumanPolicy[] = [
  { name: 'estimates, re-plan at every stop', hedge: 0, mode: 'adaptive', role: 'bar' },
  { name: 'estimates +10%, re-plan at every stop', hedge: 0.1, mode: 'adaptive', role: 'warning' },
  { name: 'estimates +20%, re-plan at every stop', hedge: 0.2, mode: 'adaptive', role: 'warning' },
  { name: 'estimates +25%, re-plan at every stop', hedge: 0.25, mode: 'adaptive', role: 'warning' },
  { name: 'estimates, one fixed plan then recover', hedge: 0, mode: 'static', role: 'bar' },
  { name: 'oracle: knows true needs (not a fair human)', hedge: 0, mode: 'oracle', role: 'reference' },
];

export interface HumanRun {
  policy: HumanPolicy;
  scoreSec: number;
  finishSec: number;
  outages: number;
  replans: number;
  sim: Sim;
}

export function runHuman(scenario: Scenario, policy: HumanPolicy, maxTicks = 60 * 60 * 10): HumanRun {
  const planner = new Planner(scenario);
  const sim = new Sim(scenario);
  const believe =
    policy.mode === 'oracle' ? (i: number) => scenario.bins[i]!.needTons : (i: number) => scenario.bins[i]!.shownTons * (1 + policy.hedge);
  let queue: Action[] = [];
  let planned = false;
  let replans = 0;

  while (!sim.finished && sim.tick < maxTicks) {
    if (sim.activity === 'idle' && sim.pending === null) {
      if (policy.mode === 'static' && planned) dropStale(sim, planner, queue);
      if (policy.mode !== 'static' || queue.length === 0) {
        queue = planner.solve(stateFromSim(planner, sim, believe), { forbidOutage: false }).actions;
        planned = true;
        replans++;
      }
      if (!issueNext(sim, planner, queue)) throw new Error(`${policy.name}: planner returned no move at tick ${sim.tick}`);
    }
    sim.advance();
  }
  if (!sim.finished) throw new Error(`${policy.name}: run did not finish`);
  return { policy, scoreSec: sim.scoreSec, finishSec: sim.elapsedSec, outages: sim.outOfFeed, replans, sim };
}

/** For the static human: skip planned stops that the truth has made pointless. */
function dropStale(sim: Sim, planner: Planner, queue: Action[]): void {
  while (queue.length) {
    const a = queue[0]!;
    if (a.type !== 'goto' || a.target === 'mill') return;
    const bin = sim.bins[a.target]!;
    const feed = planner.s.bins[a.target]!.feed;
    const onBoard = sim.comps.some((c) => c.feed === feed && c.tons > 1e-9);
    if (!bin.complete && onBoard) return;
    queue.shift();
  }
}

export interface GuaranteeResult {
  provisionRaceSec: number;
  requiredSec: number;
  bestHumanSec: number;
  bestPolicy: HumanRun;
  runs: HumanRun[];
  passed: boolean;
  /** Hedging humans who would finish ahead of ProVision's race time. */
  warnings: HumanRun[];
}

export function checkGuarantee(scenario: Scenario, policies = HUMAN_POLICIES): GuaranteeResult {
  const runs = policies.map((p) => runHuman(scenario, p));
  const bar = runs.filter((r) => r.policy.role === 'bar');
  const best = bar.reduce((a, b) => (b.scoreSec < a.scoreSec ? b : a));
  const provisionRaceSec = scenario.provision.finishSec + scenario.provision.planningSec;
  const requiredSec = provisionRaceSec + scenario.guarantee.marginSec;
  // Compare in whole ticks so rounding of the stored finishSec cannot flip a tie.
  const passed = Math.round(best.scoreSec * TICKS_PER_SEC) >= Math.round(requiredSec * TICKS_PER_SEC);
  const warnings = runs.filter((r) => r.policy.role === 'warning' && r.scoreSec < provisionRaceSec);
  return { provisionRaceSec, requiredSec, bestHumanSec: best.scoreSec, bestPolicy: best, runs, passed, warnings };
}
