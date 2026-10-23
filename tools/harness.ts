// Usage: node tools/harness.ts [scenarios/*.json ...]   (defaults to every file in scenarios/)
// Re-verifies ProVision's stored plan, runs the best-human policies, and writes guarantee.bestHumanSec,
// guarantee.passed and guarantee.inputsHash. Exits non-zero if any scenario fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseScenario, scenarioInputsHash } from '../src/scenario/schema.ts';
import { checkGuarantee } from '../src/solver/harness.ts';
import { TICKS_PER_SEC } from '../src/sim/rules.ts';
import { runPlan } from '../src/sim/sim.ts';
import { describePlan, formatJson, scenarioFiles } from './common.ts';

let failures = 0;
for (const file of scenarioFiles(process.argv.slice(2))) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const scenario = parseScenario(json, file);
  console.log(`\n=== ${scenario.name} (${scenario.id}) ===`);

  // The stored plan must still produce the stored time, with no out-of-feed events.
  const pv = runPlan(scenario, scenario.provision.plan, { startTick: Math.round(scenario.provision.planningSec * TICKS_PER_SEC) });
  const pvOk = pv.finished && pv.outOfFeed === 0 && Math.abs(pv.elapsedSec - scenario.provision.finishSec) < 0.01;
  if (!pvOk) {
    console.log(`FAIL: stored ProVision plan replays to ${pv.finished ? pv.elapsedSec.toFixed(2) + ' s' : 'no finish'} with ${pv.outOfFeed} outages; run the solver.`);
    json.guarantee.passed = false;
    writeFileSync(file, formatJson(json));
    failures++;
    continue;
  }

  const g = checkGuarantee(scenario);
  console.log(`ProVision: ${scenario.provision.finishSec.toFixed(2)} s + ${scenario.provision.planningSec} s planning = ${g.provisionRaceSec.toFixed(2)} s on the race clock`);
  console.log(`Required best human: >= ${g.requiredSec.toFixed(2)} s (margin ${scenario.guarantee.marginSec} s)\n`);
  console.log('Human policy                                         role       score   finish  outages  trips  replans  vs ProVision');
  for (const r of g.runs) {
    const gap = r.scoreSec - g.provisionRaceSec;
    console.log(
      `${r.policy.name.padEnd(50)} ${r.policy.role.padEnd(9)} ${r.scoreSec.toFixed(2).padStart(7)} ${r.finishSec.toFixed(2).padStart(8)} ${String(r.outages).padStart(7)} ${String(r.sim.trips).padStart(6)} ${String(r.replans).padStart(8)}  ${(gap >= 0 ? '+' : '') + gap.toFixed(2)} s`,
    );
  }
  console.log(`\nBest human (${g.bestPolicy.policy.name}):`);
  console.log(describePlan(scenario, g.bestPolicy.sim));
  console.log(
    `\n${g.passed ? 'PASS' : 'FAIL'}: best human ${g.bestHumanSec.toFixed(2)} s ${g.passed ? '>=' : '<'} ${g.requiredSec.toFixed(2)} s ` +
      `(ProVision wins by ${(g.bestHumanSec - g.provisionRaceSec).toFixed(2)} s)`,
  );

  for (const w of g.warnings)
    console.log(`WARNING: hedging human "${w.policy.name}" finishes ${(g.provisionRaceSec - w.scoreSec).toFixed(2)} s ahead of ProVision`);
  if (!g.warnings.length) console.log('No hedging human finishes ahead of ProVision.');

  json.guarantee.bestHumanSec = Math.round(g.bestHumanSec * 100) / 100;
  json.guarantee.passed = g.passed;
  json.guarantee.inputsHash = scenarioInputsHash(parseScenario(json, file));
  writeFileSync(file, formatJson(json));
  if (!g.passed) failures++;
}
if (failures) {
  console.error(`\n${failures} scenario(s) failed the guarantee.`);
  process.exit(1);
}
