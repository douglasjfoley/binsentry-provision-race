import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { rankBoard, rankOf, toCsv, todayStart, type BoardSettings, type RunRecord } from '../src/game/board.ts';
import { copy } from '../src/game/copy.ts';
import { cleanName, isClean } from '../src/game/names.ts';

const settings: BoardSettings = { resetTime: '06:00', manualResetAt: 0, frozenAt: 0 };
let n = 0;
function run(over: Partial<RunRecord>): RunRecord {
  return {
    runId: `r${n++}`, deviceId: 'booth-1', scenarioId: 'full-route-monday', level: 'full-route', driverName: 'DJF', company: '',
    playerSec: 70, provisionSec: 54.6, distance: 7000, trips: 3, decisionSec: 5, outOfFeed: 0, completed: true,
    startedAt: 1000, endedAt: 2000, leadCaptured: false, hidden: false, inputs: [], ...over,
  };
}

test('board: Today starts at the reset time, or at a manual reset', () => {
  const at = (h: number, m = 0) => new Date(2027, 0, 27, h, m).getTime();
  assert.equal(todayStart(at(14), settings), at(6));
  assert.equal(todayStart(at(5), settings), new Date(2027, 0, 26, 6).getTime());
  assert.equal(todayStart(at(14), { ...settings, manualResetAt: at(12) }), at(12));
});

test('board: best run per driver, fastest first; hidden, abandoned, other levels and post-freeze runs excluded', () => {
  const runs = [
    run({ driverName: 'Amy', playerSec: 80 }),
    run({ driverName: 'amy ', playerSec: 75 }),
    run({ driverName: 'Bo', playerSec: 72 }),
    run({ driverName: 'Cy', playerSec: 60, hidden: true }),
    run({ driverName: 'Di', playerSec: 50, completed: false }),
    run({ driverName: 'Ed', playerSec: 40, level: 'expert' }),
    run({ driverName: 'Fa', playerSec: 65, endedAt: 9000 }),
  ];
  assert.deepEqual(rankBoard(runs, 'full-route', 0, settings).map((e) => [e.rank, e.run.driverName, e.run.playerSec]), [
    [1, 'Fa', 65],
    [2, 'Bo', 72],
    [3, 'amy ', 75],
  ]);
  assert.deepEqual(rankBoard(runs, 'full-route', 0, { ...settings, frozenAt: 5000 }).map((e) => e.run.driverName), ['Bo', 'amy ']);
  assert.equal(rankOf(run({ driverName: 'New', playerSec: 70 }), runs, 0, settings), 2);
});

test('csv: Excel-safe (BOM, CRLF, quoting, no formula injection)', () => {
  const csv = toCsv([run({ driverName: '=HYPERLINK("x")', company: 'Peco Foods, Inc.' })]);
  assert.ok(csv.startsWith('﻿runId,'));
  assert.ok(csv.includes('\r\n'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"Peco Foods, Inc."'));
  assert.equal(csv.trimEnd().split('\r\n').length, 2);
});

test('names: profanity is replaced, ordinary names survive', () => {
  for (const ok of ['DJF', 'Cassie', 'Hellen', 'Dickson', 'Ashton', 'Grapevine Farms', 'Peacock Farms', 'Peco Foods']) assert.ok(isClean(ok), ok);
  for (const bad of ['ASS', 'FUK', 'sh1t', 'FU', 'kkk']) assert.ok(!isClean(bad), bad);
  assert.equal(cleanName('  Doug   F ', 'Guest'), 'Doug F');
  assert.equal(cleanName('', 'Guest'), 'Guest');
  assert.equal(cleanName('ABCDEFGHIJKLMNOP', 'Guest').length, 12);
});

// Brand and language rules from the brief, applied to every on-screen string and every scenario's copy.
function allCopy(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') out.push(String((v as (...a: unknown[]) => unknown)(3, 6)));
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(copy);
  for (const f of readdirSync('public/scenarios').filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(`public/scenarios/${f}`, 'utf8'));
    out.push(s.name, s.setup, s.fact ?? '', ...s.feeds.map((x: { label: string }) => x.label), ...s.bins.map((b: { farm: string }) => b.farm));
  }
  return out;
}

test('copy: ProVision spelling, no "AI", no em dashes, no banned words', () => {
  const banned = [/\bstartup\b/i, /digital transformation/i, /vendor-managed execution/i, /\bautonomous\b/i, /\bAI\b/, /\bA\.I\./i, /AI truck/i, /\bruns the feed/i];
  for (const text of allCopy()) {
    assert.ok(!text.includes('—'), `em dash in: ${text}`);
    assert.ok(!/provision/i.test(text.replace(/ProVision/g, '')), `misspelled ProVision in: ${text}`);
    for (const re of banned) assert.ok(!re.test(text), `"${re}" in: ${text}`);
  }
});
