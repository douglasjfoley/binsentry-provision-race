// Headless test runner: replays recorded input logs through the simulation and checks the results.
//
//   node tools/replay.ts [tests/replays/*.json ...]        verify logs (defaults to every file in tests/replays/)
//   node tools/replay.ts --record <scenario.json> <out.json> [policy index]
//        record a log from one of the harness's simulated humans (default: estimates, re-plan at every stop)
//
// A log holds the scenario path and hash, the inputs, and the expected finish tick, score and outages.
// The game will write the same shape for real player runs, so support can replay any run from the booth.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseScenario, scenarioInputsHash } from '../src/scenario/schema.ts';
import { HUMAN_POLICIES, runHuman } from '../src/solver/harness.ts';
import { replayInputs, type InputRecord } from '../src/sim/sim.ts';
import { formatJson } from './common.ts';

export interface ReplayLog {
  scenario: string;
  scenarioHash: string;
  description: string;
  inputs: InputRecord[];
  expect: { finishTick: number; scoreSec: number; outOfFeed: number };
}

export function verify(log: ReplayLog): string[] {
  const scenario = parseScenario(JSON.parse(readFileSync(log.scenario, 'utf8')), log.scenario);
  const problems: string[] = [];
  if (scenarioInputsHash(scenario) !== log.scenarioHash) problems.push(`scenario ${log.scenario} changed since this log was recorded`);
  const sim = replayInputs(scenario, log.inputs);
  if (!sim.finished) problems.push('run did not finish');
  if (sim.finishTick !== log.expect.finishTick) problems.push(`finish tick ${sim.finishTick}, expected ${log.expect.finishTick}`);
  if (Math.abs(sim.scoreSec - log.expect.scoreSec) > 1e-9) problems.push(`score ${sim.scoreSec}, expected ${log.expect.scoreSec}`);
  if (sim.outOfFeed !== log.expect.outOfFeed) problems.push(`${sim.outOfFeed} outages, expected ${log.expect.outOfFeed}`);
  return problems;
}

function main(args: string[]): number {
  if (args[0] === '--record') {
    const [, scenarioPath, out, idx] = args;
    if (!scenarioPath || !out) throw new Error('usage: --record <scenario.json> <out.json> [policy index]');
    const scenario = parseScenario(JSON.parse(readFileSync(scenarioPath, 'utf8')), scenarioPath);
    const policy = HUMAN_POLICIES[Number(idx ?? 0)]!;
    const run = runHuman(scenario, policy);
    const log: ReplayLog = {
      scenario: scenarioPath,
      scenarioHash: scenarioInputsHash(scenario),
      description: `Simulated human: ${policy.name}`,
      inputs: run.sim.inputs,
      expect: { finishTick: run.sim.finishTick, scoreSec: run.sim.scoreSec, outOfFeed: run.sim.outOfFeed },
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, formatJson(log));
    console.log(`recorded ${log.inputs.length} inputs to ${out}: finish tick ${log.expect.finishTick}, score ${log.expect.scoreSec.toFixed(2)} s`);
    return 0;
  }

  const files = args.length ? args : readdirSync('tests/replays').filter((f) => f.endsWith('.json')).sort().map((f) => join('tests/replays', f));
  let failed = 0;
  for (const file of files) {
    const log = JSON.parse(readFileSync(file, 'utf8')) as ReplayLog;
    const problems = verify(log);
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${file}  (${log.inputs.length} inputs, ${log.expect.scoreSec.toFixed(2)} s)`);
    for (const p of problems) console.log(`     ${p}`);
    if (problems.length) failed++;
  }
  return failed ? 1 : 0;
}

if (import.meta.filename === process.argv[1]) process.exit(main(process.argv.slice(2)));
