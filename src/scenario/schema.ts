// Scenario file contract (brief, "Data model"). Shared by the game, solver, harness and tests.
import { z } from 'zod';

const id = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/, 'ids may only use letters, digits, - and _');

export const FeedSchema = z.strictObject({
  id,
  label: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'color must be #RRGGBB'),
  icon: z.string().min(1),
});

export const BinSchema = z.strictObject({
  id,
  farm: z.string().min(1),
  node: id,
  feed: id,
  /** True (measured) need in tons. Only ProVision plans on this. */
  needTons: z.number().positive(),
  /** Estimate the player sees until the truck arrives. */
  shownTons: z.number().positive(),
  /** Fill meter at the start of the run, 0..1. */
  startFill: z.number().gt(0).max(1),
  /** Fill fraction lost per second until the bin is fully delivered. */
  drainPerSec: z.number().min(0),
  /** Tons that equal a full meter. Defaults to shownTons / (1 - startFill), so it never leaks the true need. */
  capacityTons: z.number().positive().optional(),
});

export const LoadCommandSchema = z.strictObject({
  cmd: z.literal('load'),
  /** One entry per compartment: a feed id, or null for an empty compartment. */
  mix: z.array(id.nullable()),
});

export const GotoCommandSchema = z.strictObject({
  cmd: z.literal('goto'),
  /** A bin id, or "mill". */
  target: id,
});

export const CommandSchema = z.discriminatedUnion('cmd', [LoadCommandSchema, GotoCommandSchema]);

export const ScenarioSchema = z
  .strictObject({
    id,
    level: z.enum(['quick-run', 'full-route', 'expert']),
    name: z.string().min(1),
    setup: z.string().min(1),
    fact: z.string().min(1).optional(),
    feeds: z.array(FeedSchema).min(1).max(4),
    truck: z.strictObject({
      compartments: z.number().int().min(1).max(6),
      tonsPerCompartment: z.number().positive(),
      speed: z.number().positive(),
    }),
    rates: z.strictObject({
      loadSecPerTon: z.number().min(0),
      unloadSecPerTon: z.number().min(0),
      outOfFeedPenaltySec: z.number().min(0),
      secToRealMinutes: z.number().positive(),
      /** Real-world kilometres per map unit, for the results screen. */
      kmPerMapUnit: z.number().positive().optional(),
    }),
    roads: z.strictObject({
      nodes: z.array(z.strictObject({ id, x: z.number(), y: z.number() })).min(2),
      edges: z.array(z.tuple([id, id])).min(1),
    }),
    mill: z.strictObject({ node: id }),
    bins: z.array(BinSchema).min(1).max(8),
    provision: z.strictObject({
      planningSec: z.number().min(0),
      plan: z.array(CommandSchema),
      /** Seconds from when ProVision starts moving (after planningSec) to its finish. Written by the solver. */
      finishSec: z.number().min(0),
      solverVersion: z.string(),
    }),
    guarantee: z.strictObject({
      bestHumanSec: z.number().min(0),
      marginSec: z.number().min(0),
      passed: z.boolean(),
      /** Hash of every input that affects the race. The game refuses a scenario whose inputs changed after the harness ran. */
      inputsHash: z.string().optional(),
    }),
  })
  .superRefine((s, ctx) => {
    const err = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });
    const dupes = (ids: string[]) => ids.filter((v, i) => ids.indexOf(v) !== i);

    const nodeIds = s.roads.nodes.map((n) => n.id);
    const feedIds = s.feeds.map((f) => f.id);
    const binIds = s.bins.map((b) => b.id);
    for (const d of dupes(nodeIds)) err(`duplicate road node "${d}"`, ['roads', 'nodes']);
    for (const d of dupes(feedIds)) err(`duplicate feed "${d}"`, ['feeds']);
    for (const d of dupes(binIds)) err(`duplicate bin "${d}"`, ['bins']);
    if (binIds.includes('mill')) err('"mill" is reserved and cannot be a bin id', ['bins']);

    const nodes = new Set(nodeIds);
    s.roads.edges.forEach(([a, b], i) => {
      if (!nodes.has(a)) err(`edge uses unknown node "${a}"`, ['roads', 'edges', i]);
      if (!nodes.has(b)) err(`edge uses unknown node "${b}"`, ['roads', 'edges', i]);
      if (a === b) err(`edge "${a}" connects a node to itself`, ['roads', 'edges', i]);
    });
    if (!nodes.has(s.mill.node)) err(`mill node "${s.mill.node}" is not a road node`, ['mill', 'node']);

    const binNodes = s.bins.map((b) => b.node);
    for (const d of dupes(binNodes)) err(`two bins share road node "${d}"`, ['bins']);
    s.bins.forEach((b, i) => {
      if (!nodes.has(b.node)) err(`bin ${b.id} uses unknown node "${b.node}"`, ['bins', i, 'node']);
      if (b.node === s.mill.node) err(`bin ${b.id} sits on the mill node`, ['bins', i, 'node']);
      if (!feedIds.includes(b.feed)) err(`bin ${b.id} uses unknown feed "${b.feed}"`, ['bins', i, 'feed']);
    });

    // Every node must be reachable from the mill.
    const adj = new Map<string, string[]>(nodeIds.map((n) => [n, []]));
    for (const [a, b] of s.roads.edges) {
      adj.get(a)?.push(b);
      adj.get(b)?.push(a);
    }
    const seen = new Set([s.mill.node]);
    const stack = [s.mill.node];
    while (stack.length) for (const n of adj.get(stack.pop()!) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
    for (const n of nodeIds) if (!seen.has(n)) err(`road node "${n}" is not connected to the mill`, ['roads', 'nodes']);

    s.provision.plan.forEach((c, i) => {
      if (c.cmd === 'load') {
        if (c.mix.length !== s.truck.compartments)
          err(`load mix has ${c.mix.length} slots, truck has ${s.truck.compartments}`, ['provision', 'plan', i]);
        for (const f of c.mix) if (f !== null && !feedIds.includes(f)) err(`load uses unknown feed "${f}"`, ['provision', 'plan', i]);
      } else if (c.target !== 'mill' && !binIds.includes(c.target)) {
        err(`goto targets unknown bin "${c.target}"`, ['provision', 'plan', i]);
      }
    });
  });

export type Scenario = z.infer<typeof ScenarioSchema>;
export type Bin = z.infer<typeof BinSchema>;
export type Feed = z.infer<typeof FeedSchema>;
export type Command = z.infer<typeof CommandSchema>;

/** Validate any scenario JSON (tools use this; unsolved scenarios are fine here). */
export function parseScenario(json: unknown, source = 'scenario'): Scenario {
  const r = ScenarioSchema.safeParse(json);
  if (!r.success) throw new Error(`${source} is not a valid scenario:\n${z.prettifyError(r.error)}`);
  return r.data;
}

/** Validate a scenario for play. Refuses anything the harness has not passed, or that changed since it did. */
export function loadScenarioForGame(json: unknown, source = 'scenario'): Scenario {
  const s = parseScenario(json, source);
  if (!s.guarantee.passed) throw new Error(`${source} (${s.id}) has not passed the guarantee harness and cannot be played.`);
  if (s.guarantee.inputsHash !== scenarioInputsHash(s))
    throw new Error(`${source} (${s.id}) changed after the harness ran. Run the solver and harness again.`);
  return s;
}

/** Hash of everything that affects either truck's run, plus the plan. Copy and colors are excluded. */
export function scenarioInputsHash(s: Scenario): string {
  const inputs = {
    truck: s.truck,
    rates: { ...s.rates, secToRealMinutes: undefined, kmPerMapUnit: undefined },
    roads: s.roads,
    mill: s.mill,
    feeds: s.feeds.map((f) => f.id),
    bins: s.bins,
    planningSec: s.provision.planningSec,
    plan: s.provision.plan,
    marginSec: s.guarantee.marginSec,
  };
  return fnv1a(JSON.stringify(inputs));
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
