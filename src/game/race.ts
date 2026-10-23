// One race: the player's Sim and ProVision's Sim, stepped together at a fixed 1/60 s from real elapsed time.
// The player drives with commands from taps; ProVision replays its precomputed command list.
import type { Scenario } from '../scenario/schema.ts';
import { TICKS_PER_SEC } from '../sim/rules.ts';
import { PlanDriver, Sim, type SimEvent } from '../sim/sim.ts';

const DT = 1 / TICKS_PER_SEC;
/** Never simulate more than this many steps per frame (keeps a long stall from freezing the page). */
const MAX_STEPS_PER_FRAME = 30;

export class Race {
  readonly scenario: Scenario;
  readonly player: Sim;
  readonly pv: Sim;
  readonly planningTicks: number;
  private readonly driver: PlanDriver;
  private acc = 0;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    this.planningTicks = Math.round(scenario.provision.planningSec * TICKS_PER_SEC);
    this.player = new Sim(scenario);
    this.pv = new Sim(scenario, { startTick: this.planningTicks });
    this.driver = new PlanDriver(this.pv, scenario.provision.plan);
  }

  /** Advance by real elapsed seconds. Returns events from both trucks since the last call. */
  update(dtSec: number): { player: SimEvent[]; pv: SimEvent[] } {
    this.acc = Math.min(this.acc + dtSec, MAX_STEPS_PER_FRAME * DT);
    while (this.acc >= DT && !this.player.finished) {
      this.driver.feed();
      this.pv.advance();
      this.player.advance();
      this.acc -= DT;
    }
    return { player: this.player.takeEvents(), pv: this.pv.takeEvents() };
  }

  /** Race clock in seconds (both trucks share it; ProVision starts after planningSec). */
  get clockSec(): number {
    return this.player.tick / TICKS_PER_SEC;
  }

  /** 0..1 through ProVision's planning, or undefined once it is moving. */
  get planning(): number | undefined {
    return this.player.tick < this.planningTicks ? this.player.tick / this.planningTicks : undefined;
  }

  get pvBinsDone(): number {
    return this.pv.bins.filter((b) => b.complete).length;
  }

  /** ProVision's time on the race clock, including its planning time. */
  get pvRaceSec(): number {
    return this.scenario.provision.planningSec + this.scenario.provision.finishSec;
  }

  /** True when the player's truck is parked at the mill and can load. */
  get canLoad(): boolean {
    return this.player.atMill && this.player.activity === 'idle' && this.player.pending === null && !this.player.finished;
  }

  goto(target: string): void {
    this.player.command({ cmd: 'goto', target });
  }

  load(mix: (string | null)[]): void {
    this.player.command({ cmd: 'load', mix });
  }
}
