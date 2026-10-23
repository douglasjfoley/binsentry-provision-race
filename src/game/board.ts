// Run records, leaderboard ranking and CSV export. Pure functions (no browser APIs) so they are unit-tested.
import type { InputRecord } from '../sim/sim.ts';

export interface RunRecord {
  runId: string;
  deviceId: string;
  scenarioId: string;
  level: string;
  driverName: string;
  company: string;
  /** Finish plus penalties. */
  playerSec: number;
  provisionSec: number;
  distance: number;
  trips: number;
  decisionSec: number;
  outOfFeed: number;
  completed: boolean;
  startedAt: number;
  endedAt: number;
  leadCaptured: boolean;
  hidden: boolean;
  inputs: InputRecord[];
}

export interface BoardSettings {
  /** Local time (HH:MM) the Today board resets. */
  resetTime: string;
  /** A manual "reset today" from the admin panel (epoch ms), or 0. */
  manualResetAt: number;
  /** Board frozen at this time (epoch ms): later runs are stored but not shown. 0 = not frozen. */
  frozenAt: number;
}

export interface BoardEntry {
  run: RunRecord;
  rank: number;
}

/** Start of the current "day" for the Today board. */
export function todayStart(now: number, s: BoardSettings): number {
  const [h, m] = s.resetTime.split(':').map(Number) as [number, number];
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  let start = d.getTime();
  if (start > now) start -= 24 * 3600 * 1000;
  return Math.max(start, s.manualResetAt);
}

/** Best completed run per driver (name + company), fastest first. */
export function rankBoard(runs: RunRecord[], level: string, since: number, s: BoardSettings, limit = 10): BoardEntry[] {
  const best = new Map<string, RunRecord>();
  for (const r of runs) {
    if (!r.completed || r.hidden || r.level !== level || r.endedAt < since) continue;
    if (s.frozenAt && r.endedAt > s.frozenAt) continue;
    const key = `${r.driverName.trim().toLowerCase()}|${r.company.trim().toLowerCase()}`;
    const prev = best.get(key);
    if (!prev || r.playerSec < prev.playerSec || (r.playerSec === prev.playerSec && r.endedAt < prev.endedAt)) best.set(key, r);
  }
  return [...best.values()]
    .sort((a, b) => a.playerSec - b.playerSec || a.endedAt - b.endedAt)
    .slice(0, limit)
    .map((run, i) => ({ run, rank: i + 1 }));
}

/** Rank a run would take on a board (1-based), counting each other driver's best once. */
export function rankOf(run: RunRecord, runs: RunRecord[], since: number, s: BoardSettings): number {
  const board = rankBoard([...runs.filter((r) => r.runId !== run.runId), run], run.level, since, s, Infinity);
  return board.find((e) => e.run.runId === run.runId)?.rank ?? 0;
}

export function newRunId(now: number, rand: () => number = Math.random): string {
  const stamp = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-${Math.floor(rand() * 0x10000).toString(16).padStart(4, '0')}`;
}

const CSV_COLUMNS: [string, (r: RunRecord) => string | number | boolean][] = [
  ['runId', (r) => r.runId],
  ['deviceId', (r) => r.deviceId],
  ['startedAt', (r) => new Date(r.startedAt).toISOString()],
  ['endedAt', (r) => new Date(r.endedAt).toISOString()],
  ['scenarioId', (r) => r.scenarioId],
  ['level', (r) => r.level],
  ['driverName', (r) => r.driverName],
  ['company', (r) => r.company],
  ['completed', (r) => r.completed],
  ['playerSec', (r) => r.playerSec.toFixed(2)],
  ['provisionSec', (r) => r.provisionSec.toFixed(2)],
  ['gapSec', (r) => (r.completed ? (r.playerSec - r.provisionSec).toFixed(2) : '')],
  ['distance', (r) => Math.round(r.distance)],
  ['trips', (r) => r.trips],
  ['decisionSec', (r) => r.decisionSec.toFixed(2)],
  ['outOfFeed', (r) => r.outOfFeed],
  ['hidden', (r) => r.hidden],
  ['leadCaptured', (r) => r.leadCaptured],
  ['inputs', (r) => JSON.stringify(r.inputs)],
];

/** CSV that opens cleanly in Excel (UTF-8 BOM, CRLF, quoted fields) and imports into HubSpot. */
export function toCsv(runs: RunRecord[]): string {
  const q = (v: string | number | boolean) => {
    const s = String(v);
    // Leading =, +, - or @ would be read as a formula by Excel.
    const safe = /^[=+\-@]/.test(s) && typeof v === 'string' && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [CSV_COLUMNS.map(([h]) => h).join(','), ...runs.map((r) => CSV_COLUMNS.map(([, f]) => q(f(r))).join(','))];
  return '﻿' + rows.join('\r\n') + '\r\n';
}
