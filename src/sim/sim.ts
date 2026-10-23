// Deterministic fixed-step simulation of one truck and its bins. The player and ProVision each get
// their own Sim built from the same scenario; both are driven only through command().
import type { Command, Scenario } from '../scenario/schema.ts';
import { buildGraph, type RoadGraph } from './graph.ts';
import {
  TICKS_PER_SEC,
  applyLoad,
  applyUnload,
  binCapacity,
  checkOutage,
  deliver,
  driveTicks,
  fillAt,
  initialBin,
  loadTicks,
  stepDistance,
  unloadTicks,
  type BinState,
  type Compartment,
} from './rules.ts';

const EPS = 1e-9;

export type TruckActivity = 'idle' | 'driving' | 'loading' | 'unloading';

export type SimEvent =
  | { tick: number; type: 'load'; tons: number }
  | { tick: number; type: 'depart'; from: string; target: string }
  | { tick: number; type: 'arrive'; at: string }
  | { tick: number; type: 'unload'; bin: string; tons: number; trueNeed: number }
  | { tick: number; type: 'wrongFeed'; bin: string }
  | { tick: number; type: 'outOfFeed'; bin: string }
  | { tick: number; type: 'finish' }
  | { tick: number; type: 'rejected'; cmd: Command; reason: string };

export interface InputRecord {
  /** Completed ticks when the command was issued; it applies at the start of the next step. */
  t: number;
  cmd: Command;
}

export interface SimOptions {
  /** The truck accepts no commands before this tick (ProVision's planning head start). */
  startTick?: number;
  /** Override true needs, e.g. for tests. Defaults to each bin's needTons. */
  needs?: number[];
}

export class Sim {
  readonly scenario: Scenario;
  readonly graph: RoadGraph;
  readonly startTick: number;
  readonly millNode: number;
  readonly binNode: number[];
  readonly capacity: number[];
  readonly trueNeed: number[];

  tick = 0;
  activity: TruckActivity = 'idle';
  /** Node the truck is at, or the node it left while driving. */
  node: number;
  target: string | null = null;
  pending: string | null = null;
  comps: Compartment[];
  bins: BinState[];
  revealed: boolean[];

  path: number[] = [];
  pathCum: number[] = [];
  ticksDriving = 0;
  timer = 0;

  finished = false;
  finishTick = -1;
  distance = 0;
  trips = 0;
  idleTicks = 0;
  outOfFeed = 0;
  wrongFeed = 0;

  readonly inputs: InputRecord[] = [];
  private queue: Command[] = [];
  private events: SimEvent[] = [];
  private readonly step: number;

  constructor(scenario: Scenario, opts: SimOptions = {}) {
    this.scenario = scenario;
    this.graph = buildGraph(scenario.roads);
    this.startTick = opts.startTick ?? 0;
    this.millNode = this.graph.index.get(scenario.mill.node)!;
    this.binNode = scenario.bins.map((b) => this.graph.index.get(b.node)!);
    this.capacity = scenario.bins.map(binCapacity);
    this.trueNeed = opts.needs ?? scenario.bins.map((b) => b.needTons);
    this.node = this.millNode;
    this.comps = Array.from({ length: scenario.truck.compartments }, () => ({ feed: null, tons: 0 }));
    this.bins = scenario.bins.map((b, i) => initialBin(b.startFill, this.trueNeed[i]!));
    this.revealed = scenario.bins.map(() => false);
    this.step = stepDistance(scenario);
  }

  /** Queue a command for the next step. Commands are applied in order at the start of that step. */
  command(cmd: Command): void {
    if (this.finished) return;
    this.inputs.push({ t: this.tick, cmd });
    this.queue.push(cmd);
  }

  takeEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  get atMill(): boolean {
    return this.activity !== 'driving' && this.node === this.millNode;
  }

  /** Seconds on this truck's clock: from tick 0 for the player, from startTick for ProVision. */
  get elapsedSec(): number {
    return ((this.finished ? this.finishTick : this.tick) - this.startTick) / TICKS_PER_SEC;
  }

  get penaltySec(): number {
    return this.outOfFeed * this.scenario.rates.outOfFeedPenaltySec;
  }

  get scoreSec(): number {
    return this.elapsedSec + this.penaltySec;
  }

  fill(bin: number): number {
    return fillAt(this.bins[bin]!, this.scenario.bins[bin]!.drainPerSec, this.tick);
  }

  /** Truck position in map units, for rendering. */
  position(): { x: number; y: number } {
    if (this.activity !== 'driving') return this.graph.pos[this.node]!;
    const d = Math.min(this.ticksDriving * this.step, this.pathCum[this.pathCum.length - 1]!);
    let k = 0;
    while (k < this.path.length - 2 && this.pathCum[k + 1]! <= d) k++;
    const a = this.graph.pos[this.path[k]!]!;
    const b = this.graph.pos[this.path[k + 1]!]!;
    const seg = this.pathCum[k + 1]! - this.pathCum[k]!;
    const f = seg > 0 ? (d - this.pathCum[k]!) / seg : 1;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  advance(): void {
    if (this.finished) return;
    this.applyCommands();
    this.tick++;
    this.updateBins();
    this.updateTruck();
    if (!this.finished && this.activity === 'idle' && this.node === this.millNode && this.bins.every((b) => b.complete)) {
      this.finished = true;
      this.finishTick = this.tick;
      this.events.push({ tick: this.tick, type: 'finish' });
    }
  }

  private reject(cmd: Command, reason: string): void {
    this.events.push({ tick: this.tick, type: 'rejected', cmd, reason });
  }

  private applyCommands(): void {
    const cmds = this.queue;
    this.queue = [];
    for (const cmd of cmds) {
      if (this.tick < this.startTick) {
        this.reject(cmd, 'before start');
        continue;
      }
      if (cmd.cmd === 'load') {
        if (this.activity !== 'idle' || this.node !== this.millNode) {
          this.reject(cmd, 'not idle at the mill');
          continue;
        }
        const tons = applyLoad(this.comps, cmd.mix, this.scenario.truck.tonsPerCompartment);
        this.events.push({ tick: this.tick, type: 'load', tons });
        const t = loadTicks(tons, this.scenario);
        if (t > 0) {
          this.activity = 'loading';
          this.timer = t;
        }
      } else {
        const node = this.targetNode(cmd.target);
        if (node === undefined) {
          this.reject(cmd, 'unknown target');
          continue;
        }
        if (this.activity === 'driving') this.retarget(cmd.target, node);
        else if (this.activity === 'idle') this.pending = cmd.target;
        else this.pending = cmd.target; // departs when loading or unloading finishes
      }
    }
    if (this.activity === 'idle' && this.pending !== null) {
      const target = this.pending;
      this.pending = null;
      this.depart(target);
    }
  }

  private targetNode(target: string): number | undefined {
    if (target === 'mill') return this.millNode;
    const i = this.scenario.bins.findIndex((b) => b.id === target);
    return i === -1 ? undefined : this.binNode[i];
  }

  private nodeName(node: number): string {
    if (node === this.millNode) return 'mill';
    const i = this.binNode.indexOf(node);
    return i === -1 ? this.graph.ids[node]! : this.scenario.bins[i]!.id;
  }

  private depart(target: string): void {
    const to = this.targetNode(target)!;
    if (to === this.node) return; // already there
    if (this.node === this.millNode) this.trips++;
    this.events.push({ tick: this.tick, type: 'depart', from: this.nodeName(this.node), target });
    this.setPath(this.graph.path(this.node, to));
    this.ticksDriving = 0;
    this.target = target;
    this.activity = 'driving';
  }

  /** Change destination mid-drive. The truck finishes its current road segment, then takes the shortest path. */
  private retarget(target: string, to: number): void {
    if (target === this.target) return;
    const d = this.ticksDriving * this.step;
    let k = 0; // index of the next node the truck reaches (or is exactly at)
    while (k < this.path.length - 1 && this.pathCum[k]! < d - EPS) k++;
    const via = this.path[k]!;
    const tail = this.graph.path(via, to);
    this.setPath([...this.path.slice(0, k), ...tail]);
    this.target = target;
    // If the new path ends where the truck already stands, it arrives on the next update.
  }

  private setPath(path: number[]): void {
    this.path = path;
    this.pathCum = [0];
    for (let i = 1; i < path.length; i++) this.pathCum.push(this.pathCum[i - 1]! + this.graph.edgeLength(path[i - 1]!, path[i]!));
  }

  private updateBins(): void {
    this.scenario.bins.forEach((b, i) => {
      if (checkOutage(this.bins[i]!, b.drainPerSec, this.tick)) {
        this.outOfFeed++;
        this.events.push({ tick: this.tick, type: 'outOfFeed', bin: b.id });
      }
    });
  }

  private updateTruck(): void {
    switch (this.activity) {
      case 'idle':
        if (this.tick > this.startTick) this.idleTicks++;
        return;
      case 'loading':
      case 'unloading':
        if (--this.timer <= 0) this.activity = 'idle';
        return;
      case 'driving': {
        const total = this.pathCum[this.pathCum.length - 1]!;
        const before = Math.min(this.ticksDriving * this.step, total);
        this.ticksDriving++;
        const after = Math.min(this.ticksDriving * this.step, total);
        this.distance += after - before;
        if (this.ticksDriving < driveTicks(total, this.step)) return;
        this.node = this.path[this.path.length - 1]!;
        this.activity = 'idle';
        this.target = null;
        this.events.push({ tick: this.tick, type: 'arrive', at: this.nodeName(this.node) });
        this.arrive();
      }
    }
  }

  private arrive(): void {
    const i = this.binNode.indexOf(this.node);
    if (i === -1) return;
    const spec = this.scenario.bins[i]!;
    const bin = this.bins[i]!;
    this.revealed[i] = true;
    if (bin.complete) return;
    const tons = applyUnload(this.comps, spec.feed, bin.remaining);
    if (tons <= EPS) {
      this.wrongFeed++;
      this.events.push({ tick: this.tick, type: 'wrongFeed', bin: spec.id });
      return;
    }
    deliver(bin, tons, this.capacity[i]!, spec.drainPerSec, this.tick);
    this.events.push({ tick: this.tick, type: 'unload', bin: spec.id, tons, trueNeed: this.trueNeed[i]! });
    const t = unloadTicks(tons, this.scenario);
    if (t > 0) {
      this.activity = 'unloading';
      this.timer = t;
    }
  }
}

/** Feeds a precomputed command list into a Sim as fast as the truck can take it, with zero decision time. */
export class PlanDriver {
  private i = 0;
  private readonly sim: Sim;
  private readonly plan: Command[];
  constructor(sim: Sim, plan: Command[]) {
    this.sim = sim;
    this.plan = plan;
  }

  get done(): boolean {
    return this.i >= this.plan.length;
  }

  /** Call before each sim.advance(). */
  feed(): void {
    const sim = this.sim;
    if (sim.finished || sim.activity !== 'idle' || sim.tick < sim.startTick || sim.pending !== null) return;
    // Issue everything up to and including the next goto, so a load and its departure share a step.
    while (this.i < this.plan.length) {
      const cmd = this.plan[this.i++]!;
      sim.command(cmd);
      if (cmd.cmd === 'goto') break;
    }
  }
}

/** Run a plan to completion (or a tick limit) and return the finished Sim. */
export function runPlan(scenario: Scenario, plan: Command[], opts: SimOptions = {}, maxTicks = 60 * 60 * 10): Sim {
  const sim = new Sim(scenario, opts);
  const driver = new PlanDriver(sim, plan);
  while (!sim.finished && sim.tick < maxTicks) {
    driver.feed();
    sim.advance();
    if (driver.done && sim.activity === 'idle' && !sim.finished && sim.pending === null) break;
  }
  return sim;
}

/** Replay a recorded input log exactly as it was issued. */
export function replayInputs(scenario: Scenario, inputs: InputRecord[], opts: SimOptions = {}, maxTicks = 60 * 60 * 10): Sim {
  const sim = new Sim(scenario, opts);
  let k = 0;
  while (!sim.finished && sim.tick < maxTicks) {
    while (k < inputs.length && inputs[k]!.t === sim.tick) sim.command(inputs[k++]!.cmd);
    if (k < inputs.length && inputs[k]!.t < sim.tick) throw new Error(`input ${k} at tick ${inputs[k]!.t} is out of order`);
    sim.advance();
    if (k >= inputs.length && sim.activity === 'idle' && !sim.finished) break;
  }
  return sim;
}
