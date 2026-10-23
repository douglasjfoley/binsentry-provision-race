// Timing and bin rules shared by the simulation and the solver, so both agree to the tick.
//
// Time is counted in whole ticks of 1/60 s. All action durations are whole ticks:
//   drive:  ceil(pathLength / (speed / 60)) ticks
//   load:   round(tonsAdded * loadSecPerTon * 60) ticks
//   unload: round(tonsDelivered * unloadSecPerTon * 60) ticks
// Feed is credited to a bin the tick the truck arrives; the truck then sits for the unload time.
//
// Bin fill is linear between events: fill(t) = base - drainPerSec * (t - baseTick) / 60.
// A bin runs out at the first tick where fill <= 0. It then stays at 0 (stalled) until fed,
// takes one out-of-feed penalty, and stops draining once its full need has been delivered.
// On any tick, outages are checked before a delivery arriving that same tick.
import type { Scenario } from '../scenario/schema.ts';

export const TICKS_PER_SEC = 60;
const EPS = 1e-9;

export function stepDistance(s: Scenario): number {
  return s.truck.speed / TICKS_PER_SEC;
}

export function driveTicks(distance: number, step: number): number {
  return distance <= EPS ? 0 : Math.ceil(distance / step - EPS);
}

export function loadTicks(tons: number, s: Scenario): number {
  return Math.round(tons * s.rates.loadSecPerTon * TICKS_PER_SEC);
}

export function unloadTicks(tons: number, s: Scenario): number {
  return Math.round(tons * s.rates.unloadSecPerTon * TICKS_PER_SEC);
}

export function binCapacity(b: Scenario['bins'][number]): number {
  return b.capacityTons ?? b.shownTons / (1 - Math.min(b.startFill, 0.99));
}

export interface BinState {
  remaining: number;
  delivered: number;
  /** Fill at baseTick (when not stalled). */
  base: number;
  baseTick: number;
  stalled: boolean;
  out: boolean;
  complete: boolean;
  /** Fill frozen at completion, for display. */
  finalFill: number;
}

export function initialBin(startFill: number, need: number): BinState {
  return { remaining: need, delivered: 0, base: startFill, baseTick: 0, stalled: false, out: false, complete: false, finalFill: 0 };
}

export function cloneBin(b: BinState): BinState {
  return { ...b };
}

export function fillAt(b: BinState, drainPerSec: number, tick: number): number {
  if (b.complete) return b.finalFill;
  if (b.stalled) return 0;
  return Math.max(0, b.base - (drainPerSec * (tick - b.baseTick)) / TICKS_PER_SEC);
}

/** First tick at which this bin runs out, or Infinity. */
export function outTick(b: BinState, drainPerSec: number): number {
  if (b.complete || b.stalled || drainPerSec <= 0) return Infinity;
  return b.baseTick + Math.max(0, Math.ceil((b.base * TICKS_PER_SEC) / drainPerSec - EPS));
}

/** Apply any outage at or before `tick`. Returns true if the bin newly ran out. */
export function checkOutage(b: BinState, drainPerSec: number, tick: number): boolean {
  const t = outTick(b, drainPerSec);
  if (t > tick) return false;
  b.stalled = true;
  b.base = 0;
  b.baseTick = t;
  const fresh = !b.out;
  b.out = true;
  return fresh;
}

/** Credit `tons` to the bin at `tick` (outages must already be applied). */
export function deliver(b: BinState, tons: number, capacity: number, drainPerSec: number, tick: number): void {
  const now = fillAt(b, drainPerSec, tick);
  b.base = now + tons / capacity;
  b.baseTick = tick;
  b.stalled = false;
  b.delivered += tons;
  b.remaining = Math.max(0, b.remaining - tons);
  if (b.remaining <= EPS) {
    b.remaining = 0;
    b.complete = true;
    b.finalFill = Math.min(1, b.base);
  }
}

export interface Compartment {
  feed: string | null;
  tons: number;
}

/**
 * Load the truck to `mix` (one entry per compartment). A slot already holding the same feed is topped up;
 * a slot holding another feed is emptied and refilled; null empties the slot. Returns tons added.
 */
export function applyLoad(comps: Compartment[], mix: (string | null)[], tonsPerCompartment: number): number {
  let added = 0;
  comps.forEach((c, i) => {
    const want = mix[i] ?? null;
    if (want === null) {
      c.feed = null;
      c.tons = 0;
    } else if (c.feed === want) {
      added += tonsPerCompartment - c.tons;
      c.tons = tonsPerCompartment;
    } else {
      c.feed = want;
      c.tons = tonsPerCompartment;
      added += tonsPerCompartment;
    }
  });
  return added;
}

/** Unload up to `need` tons of `feed`, emptiest matching compartment first. Returns tons unloaded. */
export function applyUnload(comps: Compartment[], feed: string, need: number): number {
  const order = comps
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.feed === feed && c.tons > EPS)
    .sort((p, q) => p.c.tons - q.c.tons || p.i - q.i);
  let given = 0;
  for (const { c } of order) {
    if (given >= need - EPS) break;
    const take = Math.min(c.tons, need - given);
    c.tons -= take;
    given += take;
    if (c.tons <= EPS) {
      c.tons = 0;
      c.feed = null;
    }
  }
  return given;
}

/**
 * Turn a wanted set of feeds into a slot-by-slot mix that keeps as much feed already on board as possible.
 * `wanted` lists one feed per filled compartment (length <= compartments).
 */
export function arrangeMix(comps: Compartment[], wanted: string[]): (string | null)[] {
  const mix: (string | null)[] = comps.map(() => null);
  const free = new Set(comps.map((_, i) => i));
  const pending: string[] = [];
  for (const feed of wanted) {
    let best = -1;
    for (const i of free) if (comps[i]!.feed === feed && (best === -1 || comps[i]!.tons > comps[best]!.tons)) best = i;
    if (best === -1) pending.push(feed);
    else {
      mix[best] = feed;
      free.delete(best);
    }
  }
  // Remaining feeds go in empty slots first, then over other feed.
  const rest = [...free].sort((a, b) => comps[a]!.tons - comps[b]!.tons || a - b);
  pending.forEach((feed, k) => (mix[rest[k]!] = feed));
  return mix;
}
