// Usage: node tools/solve.ts [public/scenarios/*.json ...]   (defaults to every file in public/scenarios/)
// Finds ProVision's optimal plan and writes provision.plan, provision.finishSec and provision.solverVersion.
// Clears guarantee.passed: run the harness afterwards.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseScenario } from '../src/scenario/schema.ts';
import { SOLVER_VERSION, solveProvision } from '../src/solver/drive.ts';
import { describePlan, formatJson, scenarioFiles } from './common.ts';

for (const file of scenarioFiles(process.argv.slice(2))) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const scenario = parseScenario(json, file);
  const sol = solveProvision(scenario);
  const { search, sim } = sol;

  console.log(`\n=== ${scenario.name} (${scenario.id}) ===`);
  console.log(`search: ${search.nodes.toLocaleString()} nodes in ${sol.searchMs.toFixed(0)} ms${search.complete ? '' : '  ** NODE LIMIT HIT: result may not be optimal **'}`);
  if (search.outages > 0) console.log(`** WARNING: no plan avoids every out-of-feed event (${search.outages} outages) **`);
  console.log(describePlan(scenario, sim));
  console.log(`ProVision finish: ${sol.finishSec.toFixed(2)} s after planning (${(sol.finishSec + scenario.provision.planningSec).toFixed(2)} s on the race clock)`);

  json.provision.plan = sol.plan;
  json.provision.finishSec = round2(sol.finishSec);
  json.provision.solverVersion = SOLVER_VERSION;
  json.guarantee.bestHumanSec = 0;
  json.guarantee.passed = false;
  delete json.guarantee.inputsHash;
  writeFileSync(file, formatJson(json));
  console.log(`wrote ${file}`);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
