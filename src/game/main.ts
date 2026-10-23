// Race the Route: boot, screen flow, race loop, taps, idle timeouts and saving runs.
import './style.css';
import { Application } from 'pixi.js';
import { registerSW } from 'virtual:pwa-register';
import { loadScenarioForGame, type Scenario } from '../scenario/schema.ts';
import { Admin } from './admin.ts';
import { newRunId, rankBoard, rankOf, todayStart, type BoardSettings, type RunRecord } from './board.ts';
import { loadConfig, type BoothConfig } from './config.ts';
import { copy } from './copy.ts';
import { h } from './dom.ts';
import { LoadPanel, MapLabels, RaceHud } from './hud.ts';
import { computeLayout, designToMap, screenToDesign, type Layout } from './layout.ts';
import { COLORS, MapView } from './map.ts';
import { Sim } from '../sim/sim.ts';
import { Race } from './race.ts';
import { attractScreen, boardScreen, cardScreen, messageScreen, nameScreen, resultsScreen } from './screens.ts';
import { Storage } from './storage.ts';

declare const __BUILD__: string;

type State = 'attract' | 'name' | 'card' | 'race' | 'finishing' | 'results' | 'board' | 'error';

const MILL_HIT = 110;
const BIN_HIT = 95;

class Game {
  private state: State = 'attract';
  private layout!: Layout;
  private readonly ui = h('div', { class: 'ui' });
  private readonly screenLayer = h('div', { class: 'screen-layer' });
  private readonly raceLayer = h('div', { class: 'race-layer' });
  private labels: MapLabels | null = null;
  private hud: RaceHud | null = null;
  private panel: LoadPanel | null = null;
  private race: Race | null = null;
  private demo: Race | null = null;
  private demoDoneAt = 0;
  /** Untouched world shown behind the scenario card: start fills and estimated needs. */
  private preview: Sim | null = null;
  private scenario: Scenario | null = null;
  private rotation = new Map<string, number>();
  private time = 0;
  private lastTouch = 0;
  private stateAt = 0;
  private driver = { name: '', company: '' };
  private raceStartedAt = 0;
  private lastRun: RunRecord | null = null;
  private readonly admin: Admin;
  private readonly map: MapView;
  private readonly app: Application;
  private readonly config: BoothConfig;
  private readonly storage: Storage;
  private readonly scenarios: Scenario[];

  constructor(app: Application, config: BoothConfig, storage: Storage, scenarios: Scenario[], rejected: { file: string; error: string }[]) {
    this.app = app;
    this.config = config;
    this.storage = storage;
    this.scenarios = scenarios;
    this.map = new MapView(app);
    this.admin = new Admin({
      config,
      storage,
      scenarios,
      rejected,
      build: __BUILD__,
      level: () => this.level(),
      setLevel: (l) => {
        void storage.updateSettings({ level: l });
      },
      boardSettings: () => this.boardSettings(),
      onClose: () => this.toAttract(),
    });
    this.ui.append(this.raceLayer, this.screenLayer, this.admin.el);
    document.getElementById('app')!.append(this.ui);

    const app$ = document.getElementById('app')!;
    // Every touch: idle timer and the admin corner (capture phase, before any button handles it).
    app$.addEventListener(
      'pointerdown',
      (e) => {
        this.lastTouch = this.time;
        const p = screenToDesign(this.layout, e.clientX, e.clientY);
        if (this.admin.cornerTap(p.x, p.y, performance.now())) e.stopPropagation();
      },
      { capture: true },
    );
    // Taps that no button handled land on the map.
    app$.addEventListener('pointerdown', (e) => this.mapTap(e));

    window.addEventListener('resize', () => this.relayout());
    this.relayout();
    this.toAttract();
    app.ticker.add((t) => this.frame(Math.min(t.deltaMS / 1000, 0.1)));
  }

  private level(): string {
    return this.storage.settings.level ?? this.config.defaultLevel;
  }

  private boardSettings(): BoardSettings {
    return { resetTime: this.config.leaderboardResetTime, manualResetAt: this.storage.settings.manualResetAt, frozenAt: this.storage.settings.frozenAt };
  }

  /** Next scenario for the current level, rotating so repeat players cannot memorize one route. */
  private pickScenario(advance: boolean): Scenario | null {
    const pool = this.scenarios.filter((s) => s.level === this.level());
    if (!pool.length) return null;
    const i = this.rotation.get(this.level()) ?? 0;
    if (advance) this.rotation.set(this.level(), i + 1);
    return pool[i % pool.length]!;
  }

  private useScenario(s: Scenario): void {
    if (this.scenario === s) return;
    this.scenario = s;
    this.map.setScenario(s);
    this.labels?.el.remove();
    this.labels = new MapLabels(s);
    this.raceLayer.prepend(this.labels.el);
    this.labels.layout(this.layout);
  }

  private relayout(): void {
    this.layout = computeLayout(window.innerWidth, window.innerHeight);
    const l = this.layout;
    Object.assign(this.ui.style, { width: `${l.W}px`, height: `${l.H}px`, transform: `translate(${l.offsetX}px, ${l.offsetY}px) scale(${l.scale})` });
    document.body.dataset.layout = l.mode;
    this.map.applyLayout(l);
    this.labels?.layout(l);
  }

  private setState(s: State, screen: HTMLElement | null): void {
    this.state = s;
    this.stateAt = this.time;
    this.screenLayer.replaceChildren(...(screen ? [screen] : []));
    document.body.dataset.state = s;
  }

  private boards(level: string) {
    const bs = this.boardSettings();
    const since = todayStart(Date.now(), bs);
    return { today: rankBoard(this.storage.runs, level, since, bs), allShow: rankBoard(this.storage.runs, level, 0, bs), since, bs };
  }

  private toAttract(): void {
    this.clearRace();
    const s = this.pickScenario(false);
    if (!s) return this.setState('error', messageScreen(copy.errors.noScenario));
    this.useScenario(s);
    this.demo = new Race(s);
    this.demoDoneAt = 0;
    this.setState(
      'attract',
      attractScreen({ today: this.boards(s.level).today, pvSec: s.provision.planningSec + s.provision.finishSec, level: s.level, onStart: () => this.toName() }),
    );
  }

  private toName(): void {
    this.setState(
      'name',
      nameScreen({
        onDone: (name, company) => {
          this.driver = { name, company };
          this.toCard();
        },
      }),
    );
  }

  private toCard(): void {
    const s = this.pickScenario(true);
    if (!s) return this.toAttract();
    this.useScenario(s);
    this.demo = null;
    this.preview = new Sim(s);
    this.setState('card', cardScreen({ scenario: s, onStart: () => this.startRace() }));
  }

  private startRace(): void {
    const s = this.scenario!;
    this.clearRace();
    this.race = new Race(s);
    this.raceStartedAt = Date.now();
    this.hud = new RaceHud(s);
    this.panel = new LoadPanel(s);
    this.raceLayer.append(this.hud.el, this.panel.el);
    this.setState('race', null);
  }

  private clearRace(): void {
    this.hud?.el.remove();
    this.panel?.el.remove();
    this.hud = this.panel = this.race = null;
  }

  private mapTap(e: PointerEvent): void {
    if (this.state !== 'race' || !this.race || this.admin.open) return;
    const p = screenToDesign(this.layout, e.clientX, e.clientY);
    const m = designToMap(this.layout, p.x, p.y);
    const s = this.race.scenario;
    let best: { target: string; d: number; x: number; y: number } | null = null;
    const consider = (target: string, x: number, y: number, r: number) => {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d <= r && (!best || d < best.d)) best = { target, d, x, y };
    };
    s.bins.forEach((b, i) => {
      const q = this.map.binPos(i);
      consider(b.id, q.x, q.y, BIN_HIT);
    });
    const mill = this.map.millPos();
    consider('mill', mill.x, mill.y, MILL_HIT);
    if (!best) return;
    const hit = best as { target: string; x: number; y: number };
    this.map.ripple(hit.x, hit.y, this.time);
    if (hit.target === 'mill' && this.race.canLoad) return; // already parked: the loading panel is open
    this.race.goto(hit.target);
  }

  private frame(dt: number): void {
    this.time += dt;
    const idle = this.time - this.lastTouch;
    const inState = this.time - this.stateAt;
    const cfg = this.config.idle;

    switch (this.state) {
      case 'attract':
      case 'name':
      case 'card': {
        if (this.state !== 'attract' && idle > cfg.setupSec) return this.toAttract();
        if (this.state === 'card' && inState > 5) return this.startRace();
        if (this.demo) {
          this.demo.update(dt);
          if (this.demo.pv.finished) {
            this.demoDoneAt ||= this.time;
            if (this.time - this.demoDoneAt > 2.5) (this.demo = new Race(this.scenario!)), (this.demoDoneAt = 0);
          }
        }
        if (this.state === 'card') {
          this.labels?.update(this.preview ?? undefined, true);
          this.map.render({ player: this.preview ?? undefined, routeAlpha: 0, time: this.time, millPulse: false });
          return;
        }
        this.labels?.update(this.demo?.pv, false);
        this.map.render({ ghost: this.demo?.pv, ghostSolid: true, routeAlpha: this.demo ? 0.25 : 0, time: this.time, millPulse: false });
        return;
      }
      case 'race':
      case 'finishing':
        return this.raceFrame(dt, idle, inState);
      case 'results':
      case 'board':
        if (idle > cfg.resultsSec && !this.admin.open) this.toAttract();
        return;
    }
  }

  private raceFrame(dt: number, idle: number, inState: number): void {
    const race = this.race!;
    if (this.state === 'race' && idle > this.config.idle.raceSec && !this.admin.open) {
      void this.saveRun(false);
      return this.toAttract();
    }
    const { player, pv } = race.update(dt);
    for (const e of player) {
      if (e.type === 'wrongFeed') this.labels!.toast(this.layout, e.bin, copy.race.wrongFeed, 'bad');
      if (e.type === 'outOfFeed') this.labels!.toast(this.layout, e.bin, copy.race.outOfFeed(race.scenario.rates.outOfFeedPenaltySec), 'bad');
    }
    if (pv.some((e) => e.type === 'finish') && !race.player.finished) this.hud!.showBanner(copy.race.banner);

    this.hud!.update(race);
    this.panel!.sync(race);
    this.labels!.update(race.player, true);
    const empty = race.player.comps.every((c) => c.tons <= 0) && !race.player.finished;
    this.map.render({
      player: race.player,
      ghost: race.pv,
      planning: race.planning,
      routeAlpha: 0.3,
      time: this.time,
      millPulse: empty && !race.player.atMill,
    });

    if (this.state === 'race' && race.player.finished) {
      this.setState('finishing', null);
      void this.saveRun(true);
    }
    if (this.state === 'finishing' && inState > 1.5) this.toResults();
  }

  private async saveRun(completed: boolean): Promise<void> {
    const race = this.race;
    if (!race) return;
    const p = race.player;
    const run: RunRecord = {
      runId: newRunId(this.raceStartedAt),
      deviceId: this.config.deviceId,
      scenarioId: race.scenario.id,
      level: race.scenario.level,
      driverName: this.driver.name,
      company: this.driver.company,
      playerSec: p.scoreSec,
      provisionSec: race.pvRaceSec,
      distance: p.distance,
      trips: p.trips,
      decisionSec: p.idleTicks / 60,
      outOfFeed: p.outOfFeed,
      completed,
      startedAt: this.raceStartedAt,
      endedAt: Date.now(),
      leadCaptured: false,
      hidden: false,
      inputs: p.inputs,
    };
    this.lastRun = run;
    await this.storage.addRun(run);
  }

  private toResults(): void {
    const run = this.lastRun!;
    const s = this.race!.scenario;
    const { since, bs } = this.boards(s.level);
    this.setState(
      'results',
      resultsScreen({
        run,
        scenario: s,
        rank: rankOf(run, this.storage.runs, since, bs),
        km: run.distance * (s.rates.kmPerMapUnit ?? 0.01),
        onPlayAgain: () => this.toName(),
        onBoard: () => this.toBoard(),
      }),
    );
  }

  private toBoard(): void {
    const s = this.race?.scenario ?? this.scenario!;
    const b = this.boards(s.level);
    this.setState(
      'board',
      boardScreen({
        level: s.level,
        pvSec: s.provision.planningSec + s.provision.finishSec,
        today: b.today,
        allShow: b.allShow,
        highlight: this.lastRun?.runId,
        config: this.config,
        onPlayAgain: () => this.toName(),
      }),
    );
  }
}

async function loadScenarios(files: string[]): Promise<{ scenarios: Scenario[]; rejected: { file: string; error: string }[] }> {
  const scenarios: Scenario[] = [];
  const rejected: { file: string; error: string }[] = [];
  for (const file of files) {
    try {
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      scenarios.push(loadScenarioForGame(await res.json(), file));
    } catch (e) {
      console.error(e);
      rejected.push({ file, error: (e as Error).message.split('\n')[0]! });
    }
  }
  return { scenarios, rejected };
}

/** After a crash, reload straight to the attract loop (leaderboard is in IndexedDB). Gives up after 3 crashes a minute. */
function installCrashReload(): void {
  const reload = (e: unknown) => {
    console.error(e);
    const key = 'rtr-crashes';
    const now = Date.now();
    const recent = (JSON.parse(sessionStorage.getItem(key) ?? '[]') as number[]).filter((t) => now - t < 60_000);
    if (recent.length >= 3) return;
    sessionStorage.setItem(key, JSON.stringify([...recent, now]));
    setTimeout(() => location.reload(), 1500);
  };
  window.addEventListener('error', (e) => reload(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reload(e.reason));
}

async function boot(): Promise<void> {
  // Tap-only kiosk: no context menu, no pinch zoom, no double-tap zoom.
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  registerSW({ immediate: true });

  try {
    const config = await loadConfig();
    const { scenarios, rejected } = await loadScenarios(config.scenarios);
    const storage = new Storage();
    await storage.open();
    const app = new Application();
    await app.init({ resizeTo: window, background: COLORS.ground, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    document.getElementById('app')!.prepend(app.canvas);
    new Game(app, config, storage, scenarios, rejected);
    installCrashReload();
  } catch (e) {
    console.error(e);
    document.getElementById('app')!.append(h('pre', { class: 'boot-error' }, (e as Error).message));
  }
}

void boot();
