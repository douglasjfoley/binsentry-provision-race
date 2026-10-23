// PixiJS map: roads, farms, mill, bins with fill meters, both trucks, ProVision's route and planning animation.
// Grey-box art: circles, lines and rounded rectangles. Phase 3 swaps in the final art.
import { Application, Container, Graphics } from 'pixi.js';
import type { Scenario } from '../scenario/schema.ts';
import { buildGraph, type RoadGraph } from '../sim/graph.ts';
import type { Sim } from '../sim/sim.ts';
import type { Layout } from './layout.ts';

export const COLORS = {
  ground: 0xe8ede3,
  field: 0xd9e3cf,
  road: 0xb9c0b4,
  roadEdge: 0xa3aa9e,
  mill: 0x46525e,
  player: 0x1f2a44,
  provision: 0x00a3ad,
  amber: 0xf29f05,
  red: 0xd93025,
  ok: 0x2e9e5b,
  binBase: 0xffffff,
};

const BIN_R = 34;
const MILL_SIZE = 96;

export interface RenderFrame {
  player?: Sim | undefined;
  ghost?: Sim | undefined;
  /** Attract loop: draw ProVision solid rather than as a ghost. */
  ghostSolid?: boolean;
  /** 0..1 through ProVision's planning animation, or undefined when not planning. */
  planning?: number | undefined;
  /** Opacity of ProVision's locked-in route line. */
  routeAlpha: number;
  /** Seconds, for pulses and flashes. */
  time: number;
  /** Mill pulses to hint at a reload. */
  millPulse: boolean;
}

interface TruckSprite {
  c: Container;
  body: Graphics;
  last: { x: number; y: number };
  sig: string;
  trail: { x: number; y: number }[];
}

export class MapView {
  readonly root = new Container();
  private readonly mapLayer = new Container();
  private readonly staticG = new Graphics();
  private readonly routeG = new Graphics();
  private readonly dynG = new Graphics();
  private readonly trailG = new Graphics();
  private readonly trucks: { player: TruckSprite; ghost: TruckSprite };
  private scenario!: Scenario;
  private graph!: RoadGraph;
  private route: { x: number; y: number }[] = [];
  private candidates: { x: number; y: number }[][] = [];
  private ripples: { x: number; y: number; t0: number }[] = [];

  constructor(app: Application) {
    app.stage.addChild(this.root);
    this.root.addChild(this.mapLayer);
    this.trucks = { ghost: makeTruck(), player: makeTruck() };
    this.mapLayer.addChild(this.staticG, this.routeG, this.trailG, this.dynG, this.trucks.ghost.c, this.trucks.player.c);
  }

  setScenario(s: Scenario): void {
    this.scenario = s;
    this.graph = buildGraph(s.roads);
    this.drawStatic();
    this.route = this.routeFor(s.provision.plan.filter((c) => c.cmd === 'goto').map((c) => (c.cmd === 'goto' ? c.target : '')));
    // Plausible-looking alternative routes for the planning animation (visual only, fixed seed).
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ids = s.bins.map((b) => b.id);
    this.candidates = Array.from({ length: 28 }, () => {
      const order = [...ids].sort(() => rnd() - 0.5);
      const stops: string[] = [];
      order.forEach((id, i) => {
        stops.push(id);
        if (i % 2 === 1 && i < order.length - 1 && rnd() < 0.7) stops.push('mill');
      });
      stops.push('mill');
      return this.routeFor(stops).map((p) => ({ x: p.x + (rnd() - 0.5) * 16, y: p.y + (rnd() - 0.5) * 16 }));
    });
  }

  applyLayout(l: Layout): void {
    this.root.scale.set(l.scale);
    this.root.position.set(l.offsetX, l.offsetY);
    this.mapLayer.position.set(l.map.x, l.map.y);
    this.mapLayer.scale.set(l.map.s);
  }

  /** Visual tap feedback at a map position. */
  ripple(x: number, y: number, time: number): void {
    this.ripples.push({ x, y, t0: time });
  }

  binPos(i: number): { x: number; y: number } {
    return this.nodePos(this.scenario.bins[i]!.node);
  }

  millPos(): { x: number; y: number } {
    return this.nodePos(this.scenario.mill.node);
  }

  private nodePos(id: string): { x: number; y: number } {
    return this.graph.pos[this.graph.index.get(id)!]!;
  }

  private routeFor(stops: string[]): { x: number; y: number }[] {
    const nodeOf = (t: string) => this.graph.index.get(t === 'mill' ? this.scenario.mill.node : this.scenario.bins.find((b) => b.id === t)!.node)!;
    let at = nodeOf('mill');
    const pts = [this.graph.pos[at]!];
    for (const t of stops) {
      const to = nodeOf(t);
      for (const n of this.graph.path(at, to).slice(1)) pts.push(this.graph.pos[n]!);
      at = to;
    }
    return pts;
  }

  private drawStatic(): void {
    const g = this.staticG;
    const s = this.scenario;
    g.clear();
    g.rect(-200, -200, 2320, 1480).fill(COLORS.ground);
    // A field patch around each farm's bins.
    const farms = new Map<string, { x: number; y: number }[]>();
    s.bins.forEach((b, i) => farms.set(b.farm, [...(farms.get(b.farm) ?? []), this.binPos(i)]));
    for (const pts of farms.values()) {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const pad = 90;
      g.roundRect(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2, 28).fill(COLORS.field);
    }
    for (const [a, b] of s.roads.edges) {
      const p = this.nodePos(a);
      const q = this.nodePos(b);
      g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 30, color: COLORS.roadEdge, cap: 'round' });
    }
    for (const [a, b] of s.roads.edges) {
      const p = this.nodePos(a);
      const q = this.nodePos(b);
      g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 22, color: COLORS.road, cap: 'round' });
    }
    const m = this.millPos();
    g.roundRect(m.x - MILL_SIZE / 2, m.y - MILL_SIZE / 2, MILL_SIZE, MILL_SIZE, 10).fill(COLORS.mill);
    g.rect(m.x - 18, m.y - MILL_SIZE / 2 - 34, 36, 40).fill(COLORS.mill);
    s.bins.forEach((b, i) => {
      const p = this.binPos(i);
      const feed = s.feeds.find((f) => f.id === b.feed)!;
      g.circle(p.x, p.y, BIN_R + 6).fill(hex(feed.color));
      g.circle(p.x, p.y, BIN_R).fill(COLORS.binBase);
    });
  }

  render(f: RenderFrame): void {
    const s = this.scenario;
    const g = this.dynG;
    g.clear();

    // ProVision's route: flickering candidates while planning, then one glowing line.
    const r = this.routeG;
    r.clear();
    if (f.planning !== undefined) {
      const lockAt = 0.8;
      if (f.planning < lockAt) {
        const shown = Math.ceil((f.planning / lockAt) * this.candidates.length);
        for (let i = 0; i < shown; i++) {
          const age = f.planning / lockAt - i / this.candidates.length;
          const alpha = Math.max(0, 0.55 - age * 2.5);
          if (alpha > 0) polyline(r, this.candidates[i]!, 4, COLORS.provision, alpha);
        }
      } else {
        const k = (f.planning - lockAt) / (1 - lockAt);
        polyline(r, this.route, 18, COLORS.provision, 0.25 * k);
        polyline(r, this.route, 7, COLORS.provision, 0.9 * k);
      }
    } else if (f.routeAlpha > 0) {
      polyline(r, this.route, 6, COLORS.provision, f.routeAlpha);
    }

    // Mill pulse.
    if (f.millPulse) {
      const m = this.millPos();
      const k = (f.time * 1.4) % 1;
      g.roundRect(m.x - MILL_SIZE / 2 - 10 - k * 30, m.y - MILL_SIZE / 2 - 10 - k * 30, MILL_SIZE + 20 + k * 60, MILL_SIZE + 20 + k * 60, 18).stroke({ width: 6, color: COLORS.provision, alpha: 1 - k });
    }

    // Bin fill meters (the player's world when racing, otherwise the ghost's).
    const world = f.player ?? f.ghost;
    if (world) {
      s.bins.forEach((b, i) => {
        const p = this.binPos(i);
        const fill = world.fill(i);
        const bin = world.bins[i]!;
        const flash = bin.out && !bin.complete && Math.floor(f.time * 4) % 2 === 0;
        const color = bin.complete ? COLORS.ok : fill <= 0 ? COLORS.red : fill <= 0.2 ? COLORS.amber : hex(s.feeds.find((x) => x.id === b.feed)!.color);
        // Meter inside the bin: a disc that fills from the bottom.
        const h = BIN_R * 2 * Math.min(1, fill);
        g.circle(p.x, p.y, BIN_R).fill(flash ? COLORS.red : COLORS.binBase);
        if (h > 0) g.poly(circleSegment(p.x, p.y, BIN_R, h)).fill(color);
        g.circle(p.x, p.y, BIN_R + 3).stroke({ width: 6, color: bin.complete ? COLORS.ok : flash ? COLORS.red : 0x2b2b2b, alpha: 0.9 });
      });
    }

    // Tap ripples.
    this.ripples = this.ripples.filter((rp) => f.time - rp.t0 < 0.5);
    for (const rp of this.ripples) {
      const k = (f.time - rp.t0) / 0.5;
      g.circle(rp.x, rp.y, 30 + k * 60).stroke({ width: 6, color: COLORS.player, alpha: 1 - k });
    }

    this.trailG.clear();
    this.drawTruck(this.trucks.ghost, f.ghost, f.ghostSolid ? 1 : 0.5, COLORS.provision, true);
    this.drawTruck(this.trucks.player, f.player, 1, COLORS.player, false);
  }

  private drawTruck(t: TruckSprite, sim: Sim | undefined, alpha: number, color: number, trail: boolean): void {
    t.c.visible = !!sim;
    if (!sim) {
      t.trail = [];
      return;
    }
    const p = sim.position();
    const dx = p.x - t.last.x;
    const dy = p.y - t.last.y;
    if (dx * dx + dy * dy > 0.01) t.c.rotation = Math.atan2(dy, dx);
    t.last = { ...p };
    t.c.position.set(p.x, p.y);
    t.c.alpha = alpha;

    const feedColors = sim.comps.map((c) => (c.feed ? hex(this.scenario.feeds.find((f) => f.id === c.feed)!.color) : 0xffffff));
    const sig = `${color}|${feedColors.join(',')}|${sim.comps.map((c) => Math.ceil(c.tons)).join(',')}`;
    if (sig !== t.sig) {
      t.sig = sig;
      const b = t.body;
      b.clear();
      b.roundRect(-34, -17, 68, 34, 7).fill(color);
      b.roundRect(18, -14, 14, 28, 4).fill(0xffffff).stroke({ width: 0 });
      const n = sim.comps.length;
      sim.comps.forEach((c, i) => {
        const w = 44 / n;
        const x = -30 + i * w;
        b.rect(x + 1, -12, w - 2, 24).fill({ color: 0xffffff, alpha: 0.25 });
        const frac = c.tons / this.scenario.truck.tonsPerCompartment;
        if (frac > 0) b.rect(x + 1, -12 + 24 * (1 - frac), w - 2, 24 * frac).fill(feedColors[i]!);
      });
    }

    if (trail) {
      t.trail.push({ ...p });
      if (t.trail.length > 24) t.trail.shift();
      t.trail.forEach((q, i) => this.trailG.circle(q.x, q.y, 3 + i * 0.4).fill({ color, alpha: (i / t.trail.length) * 0.35 * alpha }));
    }
  }
}

function makeTruck(): TruckSprite {
  const c = new Container();
  const body = new Graphics();
  c.addChild(body);
  return { c, body, last: { x: 0, y: 0 }, sig: '', trail: [] };
}

/** Polygon for the bottom `h` of a circle (a bin's fill level). */
function circleSegment(cx: number, cy: number, r: number, h: number): number[] {
  const a = Math.asin(Math.max(-1, Math.min(1, (r - h) / r)));
  const pts: number[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = a + ((Math.PI - 2 * a) * i) / steps;
    pts.push(cx + r * Math.cos(t), cy + r * Math.sin(t));
  }
  return pts;
}

function polyline(g: Graphics, pts: { x: number; y: number }[], width: number, color: number, alpha: number): void {
  if (pts.length < 2) return;
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
  g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
}

export function hex(color: string): number {
  return parseInt(color.slice(1), 16);
}
