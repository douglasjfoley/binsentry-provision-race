// Exhaustive branch-and-bound search for the fastest delivery plan from a given state.
// Uses the same tick rules as the Sim (src/sim/rules.ts), so a plan's predicted finish tick is exact.
//
// Move model (matches what a player can do):
//   at the mill: load any mix of full compartments (or keep what is on board), then drive to a bin
//   at a bin:    drive to another bin, or back to the mill
// A visit unloads automatically up to the bin's remaining need. Bins whose feed is not on board are never
// targeted (that only wastes time). Waiting never helps, because bins only drain.
// Search is complete: pruning uses admissible lower bounds and exact state dominance only.
import type { Scenario } from '../scenario/schema.ts';
import { buildGraph, type RoadGraph } from '../sim/graph.ts';
import {
  TICKS_PER_SEC,
  applyLoad,
  applyUnload,
  arrangeMix,
  binCapacity,
  checkOutage,
  cloneBin,
  deliver,
  driveTicks,
  loadTicks,
  outTick,
  stepDistance,
  unloadTicks,
  type BinState,
  type Compartment,
} from '../sim/rules.ts';

export type Action = { type: 'load'; feeds: string[] } | { type: 'goto'; target: number | 'mill' };

export interface SearchState {
  tick: number;
  /** Graph node index (the mill or a bin node). */
  node: number;
  comps: Compartment[];
  /** remaining is the need the planner believes; for ProVision it is the truth. */
  bins: BinState[];
  outages: number;
}

export interface SearchOptions {
  /** true: any out-of-feed event makes a plan invalid (ProVision). false: penalties count toward the score. */
  forbidOutage: boolean;
  /** Abort after this many expanded nodes (safety valve; reported in the result). */
  nodeLimit?: number;
}

export interface SearchResult {
  actions: Action[];
  /** Tick at which the truck is back at the mill with every bin complete. */
  finishTick: number;
  outages: number;
  /** finishTick plus penalty ticks. */
  scoreTicks: number;
  nodes: number;
  complete: boolean;
}

export class Planner {
  readonly s: Scenario;
  readonly g: RoadGraph;
  readonly mill: number;
  readonly binNode: number[];
  readonly cap: number[];
  readonly drain: number[];
  readonly feeds: string[];
  readonly binFeed: number[];
  private readonly step: number;
  private readonly tpc: number;
  /** Drive ticks between key nodes, indexed by graph node. */
  private readonly ticks: number[][];

  constructor(s: Scenario) {
    this.s = s;
    this.g = buildGraph(s.roads);
    this.mill = this.g.index.get(s.mill.node)!;
    this.binNode = s.bins.map((b) => this.g.index.get(b.node)!);
    this.cap = s.bins.map(binCapacity);
    this.drain = s.bins.map((b) => b.drainPerSec);
    this.feeds = s.feeds.map((f) => f.id);
    this.binFeed = s.bins.map((b) => this.feeds.indexOf(b.feed));
    this.step = stepDistance(s);
    this.tpc = s.truck.tonsPerCompartment;
    this.ticks = this.g.dist.map((row) => row.map((d) => driveTicks(d, this.step)));
  }

  driveTicksBetween(a: number, b: number): number {
    return this.ticks[a]![b]!;
  }

  solve(start: SearchState, opts: SearchOptions): SearchResult {
    const s = this.s;
    const nBins = s.bins.length;
    const penTicks = Math.round(s.rates.outOfFeedPenaltySec * TICKS_PER_SEC);
    const unloadPerTon = s.rates.unloadSecPerTon * TICKS_PER_SEC;
    const loadPerTon = s.rates.loadSecPerTon * TICKS_PER_SEC;
    const nodeLimit = opts.nodeLimit ?? 50_000_000;
    const memo = new Map<string, number>();
    const path: Action[] = [];
    let best: SearchResult = { actions: [], finishTick: Infinity, outages: 0, scoreTicks: Infinity, nodes: 0, complete: true };
    let nodes = 0;
    let aborted = false;

    const onboard = (comps: Compartment[]) => {
      const t = this.feeds.map(() => 0);
      for (const c of comps) if (c.feed !== null) t[this.feeds.indexOf(c.feed)]! += c.tons;
      return t;
    };
    const needByFeed = (bins: BinState[]) => {
      const t = this.feeds.map(() => 0);
      bins.forEach((b, i) => (t[this.binFeed[i]!]! += b.remaining));
      return t;
    };

    // Admissible lower bound on the remaining score from this state, including outages that can no longer be avoided.
    const lowerBound = (st: SearchState): number => {
      const have = onboard(st.comps);
      const need = needByFeed(st.bins);
      let tons = 0;
      let loadTons = 0;
      for (let f = 0; f < need.length; f++) {
        tons += need[f]!;
        loadTons += Math.max(0, need[f]! - have[f]!);
      }
      let travel = this.ticks[st.node]![this.mill]!;
      let certainOutages = 0;
      for (let i = 0; i < nBins; i++) {
        const b = st.bins[i]!;
        if (b.complete) continue;
        const bn = this.binNode[i]!;
        travel = Math.max(travel, this.ticks[st.node]![bn]! + this.ticks[bn]![this.mill]!);
        const f = this.binFeed[i]!;
        const viaMill = need[f]! > have[f]! || have[f]! === 0;
        if (viaMill && st.node !== this.mill)
          travel = Math.max(travel, this.ticks[st.node]![this.mill]! + 2 * this.ticks[this.mill]![bn]!);
        if (!b.out) {
          const earliest = st.tick + (have[f]! > 0 ? this.ticks[st.node]![bn]! : this.ticks[st.node]![this.mill]! + this.ticks[this.mill]![bn]!);
          if (outTick(b, this.drain[i]!) <= earliest) certainOutages++;
        }
      }
      if (opts.forbidOutage && certainOutages > 0) return Infinity;
      return (
        st.tick +
        travel +
        Math.floor(tons * unloadPerTon - 1e-6) +
        Math.floor(loadTons * loadPerTon - 1e-6) +
        (st.outages + certainOutages) * penTicks
      );
    };

    const key = (st: SearchState): string => {
      const comps = st.comps
        .filter((c) => c.feed !== null)
        .map((c) => `${c.feed}:${round(c.tons)}`)
        .sort()
        .join(',');
      const bins = st.bins
        .map((b, i) => {
          if (b.complete) return 'c' + (b.out ? '!' : '');
          // Bins that never ran out have fill fixed by tick and tons delivered; after an outage the intercept matters.
          const extra = b.out ? (b.stalled ? 's' : `r${round(b.base + (this.drain[i]! * -b.baseTick) / TICKS_PER_SEC)}`) : '';
          return `${round(b.remaining)}${extra}`;
        })
        .join('|');
      return `${st.node}/${comps}/${bins}`;
    };

    // Advance to `tick`, applying outages. Returns false if an outage is forbidden.
    const applyOutages = (st: SearchState, tick: number): boolean => {
      for (let i = 0; i < nBins; i++) {
        if (checkOutage(st.bins[i]!, this.drain[i]!, tick)) {
          if (opts.forbidOutage) return false;
          st.outages++;
        }
      }
      st.tick = tick;
      return true;
    };

    const clone = (st: SearchState): SearchState => ({
      tick: st.tick,
      node: st.node,
      comps: st.comps.map((c) => ({ ...c })),
      bins: st.bins.map(cloneBin),
      outages: st.outages,
    });

    const finish = (st: SearchState) => {
      const score = st.tick + st.outages * penTicks;
      if (score < best.scoreTicks) {
        best = { actions: [...path], finishTick: st.tick, outages: st.outages, scoreTicks: score, nodes: 0, complete: true };
      }
    };

    const visit = (st: SearchState, atMillFresh: boolean): void => {
      if (aborted) return;
      if (++nodes > nodeLimit) {
        aborted = true;
        return;
      }
      const allDone = st.bins.every((b) => b.complete);
      if (allDone && st.node === this.mill) return finish(st);
      if (lowerBound(st) >= best.scoreTicks) return;
      const k = `${atMillFresh ? 'L' : 'D'}${key(st)}`;
      const seen = memo.get(k);
      if (seen !== undefined && seen <= st.tick + st.outages * penTicks) return;
      memo.set(k, st.tick + st.outages * penTicks);

      if (atMillFresh) {
        // Choose a load, then a first bin. "Keep" (no load) is the empty choice when feed is already on board.
        for (const wanted of this.loadChoices(st)) {
          const next = clone(st);
          let t = st.tick;
          if (wanted !== null) {
            const mix = arrangeMix(next.comps, wanted);
            t += loadTicks(applyLoad(next.comps, mix, this.tpc), s);
            if (!applyOutages(next, t)) continue;
            path.push({ type: 'load', feeds: wanted });
          }
          visit(next, false);
          if (wanted !== null) path.pop();
        }
        return;
      }

      const have = onboard(st.comps);
      const targets: number[] = [];
      for (let i = 0; i < nBins; i++) if (!st.bins[i]!.complete && have[this.binFeed[i]!]! > 1e-9) targets.push(i);
      // Nearest first finds good incumbents early.
      targets.sort((a, b) => this.ticks[st.node]![this.binNode[a]!]! - this.ticks[st.node]![this.binNode[b]!]! || a - b);

      for (const i of targets) {
        const bn = this.binNode[i]!;
        if (bn === st.node) continue;
        const next = clone(st);
        if (!applyOutages(next, st.tick + this.ticks[st.node]![bn]!)) continue;
        next.node = bn;
        const tons = applyUnload(next.comps, s.bins[i]!.feed, next.bins[i]!.remaining);
        deliver(next.bins[i]!, tons, this.cap[i]!, this.drain[i]!, next.tick);
        next.tick += unloadTicks(tons, s);
        path.push({ type: 'goto', target: i });
        visit(next, false);
        path.pop();
      }
      if (st.node !== this.mill) {
        const next = clone(st);
        if (applyOutages(next, st.tick + this.ticks[st.node]![this.mill]!)) {
          next.node = this.mill;
          path.push({ type: 'goto', target: 'mill' });
          visit(next, !next.bins.every((b) => b.complete));
          path.pop();
        }
      }
    };

    visit(clone(start), start.node === this.mill);
    return { ...best, nodes, complete: !aborted };
  }

  /** Load options at the mill: every multiset of useful feeds, plus null for "leave with what is on board". */
  private loadChoices(st: SearchState): (string[] | null)[] {
    const need = this.feeds.map(() => 0);
    st.bins.forEach((b, i) => (need[this.binFeed[i]!]! += b.remaining));
    // Never load a compartment of a feed that could not be delivered even if the others were full.
    const maxCount = need.map((n) => Math.min(this.s.truck.compartments, Math.ceil(n / this.tpc - 1e-9)));
    const out: (string[] | null)[] = [];
    const counts = this.feeds.map(() => 0);
    const rec = (f: number, used: number) => {
      if (f === this.feeds.length) {
        if (used > 0) out.push(counts.flatMap((c, i) => Array<string>(c).fill(this.feeds[i]!)));
        return;
      }
      for (let c = 0; c <= maxCount[f]! && used + c <= this.s.truck.compartments; c++) {
        counts[f] = c;
        rec(f + 1, used + c);
      }
      counts[f] = 0;
    };
    rec(0, 0);
    // Fuller loads first: they usually make better incumbents.
    out.sort((a, b) => b!.length - a!.length);
    const usefulOnBoard = st.comps.some((c) => c.feed !== null && c.tons > 1e-9 && need[this.feeds.indexOf(c.feed)]! > 1e-9);
    if (usefulOnBoard) out.push(null);
    return out;
  }
}

function round(x: number): string {
  return (Math.round(x * 1e6) / 1e6).toString();
}
