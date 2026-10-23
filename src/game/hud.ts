// Race overlays: bin labels on the map, the top bar, the truck panel, the loading panel and toasts.
import type { Scenario } from '../scenario/schema.ts';
import type { Sim } from '../sim/sim.ts';
import { copy } from './copy.ts';
import { feedChip, fmtSec, h, onTap, setText } from './dom.ts';
import { mapToDesign, type Layout } from './layout.ts';
import type { Race } from './race.ts';

const fmtTons = (t: number) => (Math.round(t * 10) / 10).toString();

/** What the player can see about a bin's need: an estimate until visited, then the truth. */
export function visibleNeed(s: Scenario, sim: Sim, i: number): { tons: number; estimate: boolean; complete: boolean } {
  const bin = sim.bins[i]!;
  if (bin.complete) return { tons: 0, estimate: false, complete: true };
  if (sim.revealed[i]) return { tons: bin.remaining, estimate: false, complete: false };
  return { tons: s.bins[i]!.shownTons, estimate: true, complete: false };
}

export class MapLabels {
  readonly el = h('div', { class: 'map-labels' });
  private bins: { root: HTMLElement; need: HTMLElement }[] = [];
  private mill: HTMLElement;
  private scenario: Scenario;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    this.bins = scenario.bins.map((b) => {
      const fi = scenario.feeds.findIndex((f) => f.id === b.feed);
      const feed = scenario.feeds[fi]!;
      const need = h('span', { class: 'need' });
      const root = h(
        'div',
        { class: 'bin-label' },
        h('span', { class: 'bin-id' }, b.id),
        h('span', { class: 'feed' }, feedChip(fi, feed.color, feed.label), feed.label),
        need,
      );
      this.el.append(root);
      return { root, need };
    });
    this.mill = h('div', { class: 'mill-label' }, 'Mill');
    this.el.append(this.mill);
  }

  layout(l: Layout): void {
    const place = (el: HTMLElement, node: string, dx: number, dy: number, flip = false) => {
      const n = this.scenario.roads.nodes.find((x) => x.id === node)!;
      const p = mapToDesign(l, n.x, n.y);
      const x = p.x + (flip ? -dx : dx) * l.map.s;
      el.style.transform = `translate(${x}px, ${p.y + dy * l.map.s}px) scale(${Math.max(0.8, l.map.s)})${flip ? ' translateX(-100%)' : ''}`;
    };
    // Bins near the right edge get their label on the left so it stays on screen.
    this.scenario.bins.forEach((b, i) => {
      const n = this.scenario.roads.nodes.find((x) => x.id === b.node)!;
      place(this.bins[i]!.root, b.node, 52, -40, n.x > 1600);
    });
    place(this.mill, this.scenario.mill.node, -40, 56);
  }

  update(sim: Sim | undefined, showNeeds: boolean): void {
    this.scenario.bins.forEach((_, i) => {
      const lab = this.bins[i]!;
      if (!sim || !showNeeds) {
        setText(lab.need, '');
        lab.root.classList.remove('estimate', 'done', 'out');
        return;
      }
      const n = visibleNeed(this.scenario, sim, i);
      setText(lab.need, n.complete ? copy.race.full : n.estimate ? copy.race.estimate(fmtTons(n.tons)) : copy.race.exact(fmtTons(n.tons)));
      lab.root.classList.toggle('estimate', n.estimate);
      lab.root.classList.toggle('done', n.complete);
      lab.root.classList.toggle('out', sim.bins[i]!.out && !n.complete);
    });
  }

  /** Floating text near a bin, in design coordinates. */
  toast(l: Layout, binId: string, text: string, kind: 'bad' | 'info'): void {
    const b = this.scenario.bins.find((x) => x.id === binId);
    if (!b) return;
    const n = this.scenario.roads.nodes.find((x) => x.id === b.node)!;
    const p = mapToDesign(l, n.x, n.y);
    const t = h('div', { class: `map-toast ${kind}`, style: `left:${p.x}px;top:${p.y - 70}px` }, text);
    this.el.append(t);
    setTimeout(() => t.remove(), 1600);
  }
}

export class RaceHud {
  readonly el: HTMLElement;
  private clock = h('div', { class: 'clock' });
  private penalty = h('div', { class: 'penalty' });
  private pvText = h('div', { class: 'pv-text' });
  private pvBar = h('div', { class: 'pv-bar-fill' });
  private pvTime = h('div', { class: 'pv-time' });
  private planning = h('div', { class: 'planning' }, copy.race.planning);
  private banner = h('div', { class: 'banner' });
  private gauges: { fill: HTMLElement; chip: HTMLElement; tons: HTMLElement }[];
  private scenario: Scenario;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    this.gauges = Array.from({ length: scenario.truck.compartments }, () => ({
      fill: h('div', { class: 'gauge-fill' }),
      chip: h('div', { class: 'gauge-chip' }),
      tons: h('div', { class: 'gauge-tons' }),
    }));
    this.el = h(
      'div',
      { class: 'race-hud' },
      h(
        'div',
        { class: 'top-bar' },
        h('div', { class: 'clock-box' }, this.clock, this.penalty),
        h('div', { class: 'pv-box' }, this.pvText, h('div', { class: 'pv-bar' }, this.pvBar), this.pvTime),
      ),
      this.planning,
      this.banner,
      h(
        'div',
        { class: 'truck-panel' },
        h('div', { class: 'panel-title' }, copy.race.truck),
        h('div', { class: 'gauges' }, ...this.gauges.map((g) => h('div', { class: 'gauge' }, h('div', { class: 'gauge-tube' }, g.fill), g.chip, g.tons))),
      ),
    );
  }

  update(race: Race): void {
    const s = this.scenario;
    const p = race.player;
    setText(this.clock, fmtSec(race.clockSec));
    setText(this.penalty, p.penaltySec ? copy.race.penalty(p.penaltySec) : '');
    const done = race.pvBinsDone;
    setText(this.pvText, copy.race.progress(done, s.bins.length));
    this.pvBar.style.width = `${(done / s.bins.length) * 100}%`;
    setText(this.pvTime, race.pv.finished ? copy.race.provisionDone(fmtSec(race.pvRaceSec)) : '');
    this.planning.classList.toggle('show', race.planning !== undefined);
    p.comps.forEach((c, i) => {
      const g = this.gauges[i]!;
      const fi = s.feeds.findIndex((f) => f.id === c.feed);
      const feed = s.feeds[fi];
      g.fill.style.height = `${(c.tons / s.truck.tonsPerCompartment) * 100}%`;
      g.fill.style.background = feed?.color ?? 'transparent';
      const sig = `${c.feed}`;
      if (g.chip.dataset.sig !== sig) {
        g.chip.dataset.sig = sig;
        g.chip.replaceChildren(feed ? feedChip(fi, feed.color, feed.label) : '');
      }
      setText(g.tons, feed && c.tons > 0 ? `${fmtTons(c.tons)} t` : copy.race.empty);
    });
  }

  showBanner(text: string): void {
    setText(this.banner, text);
    this.banner.classList.add('show');
    setTimeout(() => this.banner.classList.remove('show'), 2500);
  }
}

export class LoadPanel {
  readonly el: HTMLElement;
  private slots: HTMLElement[];
  private needEls: HTMLElement[];
  private planned: (string | null)[] = [];
  private race: Race | null = null;
  private visible = false;
  private readonly scenario: Scenario;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    this.slots = Array.from({ length: scenario.truck.compartments }, (_, i) => {
      const slot = h('div', { class: 'slot' });
      onTap(slot, () => {
        this.planned[i] = null;
        this.render();
      });
      return slot;
    });
    this.needEls = scenario.feeds.map(() => h('div', { class: 'feed-need' }));
    const feedButtons = scenario.feeds.map((f, fi) => {
      const b = h('div', { class: 'feed-button', style: `--feed:${f.color}` }, feedChip(fi, f.color, f.label, true), h('div', { class: 'feed-label' }, f.label), this.needEls[fi]!);
      onTap(b, () => {
        const i = this.planned.indexOf(null);
        if (i !== -1) this.planned[i] = f.id;
        this.render();
      });
      return b;
    });
    const go = h('div', { class: 'go-button' }, copy.load.go);
    onTap(go, () => {
      this.race?.load([...this.planned]);
      this.hide();
    });
    this.el = h(
      'div',
      { class: 'load-panel' },
      h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, copy.load.title), h('div', { class: 'panel-hint' }, copy.load.hint)),
      h('div', { class: 'load-body' }, h('div', { class: 'slots' }, ...this.slots), h('div', { class: 'feed-buttons' }, h('div', { class: 'needed-title' }, copy.load.needed), ...feedButtons), go),
    );
  }

  /** Call every frame: shows the panel whenever the truck is parked at the mill. */
  sync(race: Race): void {
    this.race = race;
    const want = race.canLoad;
    if (want && !this.visible) {
      this.planned = race.player.comps.map((c) => c.feed);
      this.visible = true;
      this.el.classList.add('show');
      this.render();
    } else if (!want && this.visible) this.hide();
    if (this.visible) this.renderNeeds();
  }

  hide(): void {
    this.visible = false;
    this.el.classList.remove('show');
  }

  private render(): void {
    const s = this.scenario;
    const comps = this.race?.player.comps ?? [];
    this.slots.forEach((slot, i) => {
      const want = this.planned[i] ?? null;
      const fi = s.feeds.findIndex((f) => f.id === want);
      const feed = s.feeds[fi];
      const cur = comps[i];
      const keeps = feed && cur && cur.feed === want && cur.tons > 0;
      const full = keeps && cur!.tons >= s.truck.tonsPerCompartment;
      slot.replaceChildren(
        feed ? feedChip(fi, feed.color, feed.label, true) : h('span', { class: 'slot-empty' }, copy.race.empty),
        h('div', { class: 'slot-label' }, feed ? feed.label : ''),
        h('div', { class: 'slot-sub' }, full ? copy.load.onBoard(fmtTons(cur!.tons)) : keeps ? `${copy.load.onBoard(fmtTons(cur!.tons))}, ${copy.load.topUp}` : feed ? `${s.truck.tonsPerCompartment} t` : ''),
      );
      slot.classList.toggle('filled', !!feed);
      slot.style.setProperty('--feed', feed?.color ?? '#999');
    });
  }

  private renderNeeds(): void {
    const s = this.scenario;
    const sim = this.race!.player;
    s.feeds.forEach((f, fi) => {
      let tons = 0;
      let estimate = false;
      s.bins.forEach((b, i) => {
        if (b.feed !== f.id) return;
        const n = visibleNeed(s, sim, i);
        tons += n.tons;
        estimate ||= n.estimate;
      });
      setText(this.needEls[fi]!, tons === 0 ? copy.race.full : estimate ? copy.race.estimate(fmtTons(tons)) : copy.race.exact(fmtTons(tons)));
    });
  }
}
