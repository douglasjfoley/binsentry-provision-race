import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadScenarioForGame, parseScenario, scenarioInputsHash, type Scenario } from '../src/scenario/schema.ts';
import { buildGraph } from '../src/sim/graph.ts';
import { Sim, runPlan } from '../src/sim/sim.ts';
import { solveProvision } from '../src/solver/drive.ts';
import { verify, type ReplayLog } from '../tools/replay.ts';

const monday = () => parseScenario(JSON.parse(readFileSync('scenarios/full-route-monday.json', 'utf8')));

// Speed 60 = 1 map unit per tick, so drive times are easy to read. Load 1 tick/ton, unload 1 tick/ton.
function tiny(over: Partial<Scenario['bins'][number]>[] = []): Scenario {
  const bins = [
    { id: 'B1', farm: 'F', node: 'b1', feed: 'starter', needTons: 5, shownTons: 4, startFill: 0.5, drainPerSec: 0 },
    { id: 'B2', farm: 'F', node: 'b2', feed: 'grower', needTons: 3, shownTons: 3, startFill: 0.5, drainPerSec: 0 },
  ].map((b, i) => ({ ...b, ...over[i] }));
  return parseScenario({
    id: 'tiny', level: 'quick-run', name: 'Tiny', setup: 'Test.',
    feeds: [
      { id: 'starter', label: 'Starter', color: '#F2B705', icon: 's.svg' },
      { id: 'grower', label: 'Grower', color: '#3E8EDE', icon: 'g.svg' },
    ],
    truck: { compartments: 2, tonsPerCompartment: 8, speed: 60 },
    rates: { loadSecPerTon: 1 / 60, unloadSecPerTon: 1 / 60, outOfFeedPenaltySec: 10, secToRealMinutes: 6 },
    roads: {
      nodes: [{ id: 'mill', x: 0, y: 0 }, { id: 'j', x: 100, y: 0 }, { id: 'b1', x: 100, y: 100 }, { id: 'b2', x: 200, y: 0 }],
      edges: [['mill', 'j'], ['j', 'b1'], ['j', 'b2']],
    },
    mill: { node: 'mill' },
    bins,
    provision: { planningSec: 0, plan: [], finishSec: 0, solverVersion: 'test' },
    guarantee: { bestHumanSec: 0, marginSec: 5, passed: false },
  });
}

function runUntil(sim: Sim, done: (s: Sim) => boolean, limit = 10_000) {
  while (!done(sim) && sim.tick < limit) sim.advance();
}

test('graph: shortest paths and distances', () => {
  const g = buildGraph(tiny().roads);
  const id = (n: string) => g.index.get(n)!;
  assert.deepEqual(g.path(id('b1'), id('b2')).map((i) => g.ids[i]), ['b1', 'j', 'b2']);
  assert.equal(g.dist[id('mill')]![id('b2')], 200);
  assert.equal(g.dist[id('b2')]![id('b1')], g.dist[id('b1')]![id('b2')]);
});

test('sim: load, deliver, top up and finish with exact tick counts', () => {
  const sim = new Sim(tiny());
  sim.command({ cmd: 'load', mix: ['starter', 'grower'] });
  sim.command({ cmd: 'goto', target: 'B1' });
  runUntil(sim, (s) => s.revealed[0]!);
  assert.equal(sim.tick, 16 + 200, '16 tons loaded at 1 tick each, then 200 units of road');
  assert.equal(sim.bins[0]!.remaining, 0);
  assert.deepEqual(sim.comps.map((c) => c.tons), [3, 8]);
  sim.command({ cmd: 'goto', target: 'B2' });
  runUntil(sim, (s) => s.revealed[1]!);
  assert.equal(sim.tick, 216 + 5 + 200, 'unload 5 tons, then 200 units to B2');
  sim.command({ cmd: 'goto', target: 'mill' });
  runUntil(sim, (s) => s.finished);
  assert.equal(sim.finishTick, 421 + 3 + 200);
  assert.equal(sim.trips, 1);
  assert.equal(sim.distance, 600);

  // Top-up only charges for the tons actually added.
  const t = new Sim(tiny());
  t.comps[0] = { feed: 'starter', tons: 3 };
  t.command({ cmd: 'load', mix: ['starter', null] });
  t.advance();
  assert.equal(t.takeEvents().find((e) => e.type === 'load')?.tons, 5);
});

test('sim: wrong feed unloads nothing; load away from the mill is rejected', () => {
  const sim = new Sim(tiny());
  sim.command({ cmd: 'load', mix: ['grower', null] });
  sim.command({ cmd: 'goto', target: 'B1' });
  runUntil(sim, (s) => s.revealed[0]!);
  assert.equal(sim.wrongFeed, 1);
  assert.equal(sim.bins[0]!.remaining, 5);
  sim.command({ cmd: 'load', mix: ['starter', 'starter'] });
  sim.advance();
  assert.ok(sim.takeEvents().some((e) => e.type === 'rejected'));
});

test('sim: true need is used, not the estimate, and a short load leaves the bin open', () => {
  const sim = new Sim(tiny([{ needTons: 10 }]));
  sim.command({ cmd: 'load', mix: ['starter', 'grower'] });
  sim.command({ cmd: 'goto', target: 'B1' });
  runUntil(sim, (s) => s.revealed[0]!);
  assert.equal(sim.bins[0]!.remaining, 2);
  assert.equal(sim.bins[0]!.complete, false);
});

test('sim: out of feed fires once per bin and adds the penalty', () => {
  // 0.5 fill at 0.05/s runs out at 10 s = tick 600.
  const sim = new Sim(tiny([{ drainPerSec: 0.05 }]));
  runUntil(sim, (s) => s.tick >= 700);
  assert.equal(sim.outOfFeed, 1);
  assert.equal(sim.fill(0), 0);
  sim.command({ cmd: 'load', mix: ['starter', 'grower'] });
  sim.command({ cmd: 'goto', target: 'B1' });
  runUntil(sim, (s) => s.revealed[0]!);
  sim.command({ cmd: 'goto', target: 'B2' });
  runUntil(sim, (s) => s.revealed[1]!);
  sim.command({ cmd: 'goto', target: 'mill' });
  runUntil(sim, (s) => s.finished);
  assert.equal(sim.outOfFeed, 1);
  assert.equal(sim.scoreSec, sim.finishTick / 60 + 10);
});

test('sim: retargeting finishes the current road segment, then turns', () => {
  const sim = new Sim(tiny());
  sim.command({ cmd: 'load', mix: ['starter', 'grower'] });
  sim.command({ cmd: 'goto', target: 'B2' });
  runUntil(sim, (s) => s.tick === 16 + 50); // halfway from the mill to j
  sim.command({ cmd: 'goto', target: 'B1' });
  runUntil(sim, (s) => s.revealed[0]!);
  assert.equal(sim.revealed[1], false);
  assert.equal(sim.tick, 16 + 200, 'mill -> j -> b1 is still 200 units');
  assert.equal(sim.distance, 200);
});

test('sim: commands before the start tick are rejected (ProVision head start)', () => {
  const sim = new Sim(tiny(), { startTick: 180 });
  sim.command({ cmd: 'load', mix: ['starter', 'grower'] });
  sim.advance();
  assert.ok(sim.takeEvents().some((e) => e.type === 'rejected'));
  assert.equal(sim.activity, 'idle');
});

test('ProVision: solver plan replays to the same tick every time, with no outages', () => {
  const s = monday();
  const startTick = s.provision.planningSec * 60;
  const a = runPlan(s, s.provision.plan, { startTick });
  const b = runPlan(s, s.provision.plan, { startTick });
  assert.ok(a.finished);
  assert.equal(a.finishTick, b.finishTick);
  assert.equal(a.outOfFeed, 0);
  assert.ok(Math.abs(a.elapsedSec - s.provision.finishSec) < 0.01);
  // Re-solving gives the same answer (the solver is deterministic too).
  assert.deepEqual(solveProvision(s).plan, s.provision.plan);
});

test('replay logs reproduce their recorded results', () => {
  for (const f of readdirSync('tests/replays').filter((f) => f.endsWith('.json'))) {
    const log = JSON.parse(readFileSync(`tests/replays/${f}`, 'utf8')) as ReplayLog;
    assert.deepEqual(verify(log), [], f);
  }
});

test('schema: the game refuses unpassed or edited scenarios', () => {
  const json = JSON.parse(readFileSync('scenarios/full-route-monday.json', 'utf8'));
  assert.doesNotThrow(() => loadScenarioForGame(json), 'the shipped scenario must be playable');
  const unpassed = { ...json, guarantee: { ...json.guarantee, passed: false } };
  assert.throws(() => loadScenarioForGame(unpassed), /has not passed/);
  const s = parseScenario(json);
  const passed = { ...json, guarantee: { ...json.guarantee, passed: true, inputsHash: scenarioInputsHash(s) } };
  assert.doesNotThrow(() => loadScenarioForGame(passed));
  const edited = structuredClone(passed);
  edited.bins[0].needTons += 1;
  assert.throws(() => loadScenarioForGame(edited), /changed after the harness ran/);
  const broken = structuredClone(json);
  broken.bins[0].feed = 'premix';
  assert.throws(() => parseScenario(broken), /unknown feed "premix"/);
});
