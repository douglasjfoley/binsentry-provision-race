import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Scenario } from '../src/scenario/schema.ts';
import { TICKS_PER_SEC } from '../src/sim/rules.ts';
import type { Sim } from '../src/sim/sim.ts';

export function scenarioFiles(args: string[]): string[] {
  if (args.length) return args;
  return readdirSync('scenarios')
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join('scenarios', f));
}

const sec = (tick: number) => (tick / TICKS_PER_SEC).toFixed(2).padStart(6);

/** Human-readable timeline of a finished run (consumes the sim's pending events). */
export function describePlan(s: Scenario, sim: Sim): string {
  const label = (id: string) => s.feeds.find((f) => f.id === id)?.label ?? id;
  const lines: string[] = [];
  for (const e of sim.takeEvents()) {
    switch (e.type) {
      case 'load':
        lines.push(`${sec(e.tick)}s  load ${e.tons} t`);
        break;
      case 'depart':
        lines.push(`${sec(e.tick)}s  ${e.from} -> ${e.target}`);
        break;
      case 'unload':
        lines.push(`${sec(e.tick)}s    unload ${e.tons} t at ${e.bin} (true need ${e.trueNeed} t)`);
        break;
      case 'arrive':
        if (e.at === 'mill') lines.push(`${sec(e.tick)}s    arrive mill`);
        break;
      case 'wrongFeed':
        lines.push(`${sec(e.tick)}s    WRONG FEED at ${e.bin}`);
        break;
      case 'outOfFeed':
        lines.push(`${sec(e.tick)}s    OUT OF FEED: ${e.bin}`);
        break;
      case 'finish':
        lines.push(`${sec(e.tick)}s  finish`);
        break;
      case 'rejected':
        lines.push(`${sec(e.tick)}s    rejected ${JSON.stringify(e.cmd)}: ${e.reason}`);
    }
  }
  const loads = sim.inputs.filter((r) => r.cmd.cmd === 'load').map((r) => (r.cmd.cmd === 'load' ? r.cmd.mix.map((m) => (m ? label(m) : '-')).join('/') : ''));
  lines.push(`loads: ${loads.join('  |  ')}`);
  lines.push(
    `distance ${Math.round(sim.distance)} units, trips ${sim.trips}, idle ${(sim.idleTicks / TICKS_PER_SEC).toFixed(2)} s, ` +
      `out-of-feed ${sim.outOfFeed}, wrong-feed stops ${sim.wrongFeed}`,
  );
  const minFill = s.bins.map((b, i) => `${b.id} ${(sim.bins[i]!.finalFill * 100).toFixed(0)}%`).join(', ');
  lines.push(`final fill: ${minFill}`);
  return lines.join('\n');
}

/** JSON with short objects and arrays kept on one line, so scenario files stay hand-editable. */
export function formatJson(value: unknown): string {
  const fmt = (v: unknown, indent: string): string => {
    const flat = JSON.stringify(v);
    if (flat === undefined) return 'null';
    if (typeof v !== 'object' || v === null || flat.length + indent.length <= 110) return flat.replace(/([,:])(?=[^\s"\]}])|([,:])(?=")/g, '$1$2 ');
    const inner = indent + '  ';
    if (Array.isArray(v)) return `[\n${v.map((x) => inner + fmt(x, inner)).join(',\n')}\n${indent}]`;
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${fmt(x, inner)}`).join(',\n')}\n${indent}}`;
  };
  return fmt(value, '') + '\n';
}
