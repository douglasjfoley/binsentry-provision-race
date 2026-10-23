// Road graph with all-pairs shortest paths (Dijkstra from every node; the graph is small).
import type { Scenario } from '../scenario/schema.ts';

export interface RoadGraph {
  ids: string[];
  pos: { x: number; y: number }[];
  index: Map<string, number>;
  /** dist[a][b] in map units. */
  dist: number[][];
  /** next[a][b]: the node after a on the shortest path to b (a itself when a === b). */
  next: number[][];
  /** Node indices from a to b inclusive. */
  path(a: number, b: number): number[];
  edgeLength(a: number, b: number): number;
}

export function buildGraph(roads: Scenario['roads']): RoadGraph {
  const ids = roads.nodes.map((n) => n.id);
  const pos = roads.nodes.map((n) => ({ x: n.x, y: n.y }));
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const len = (a: number, b: number) => Math.hypot(pos[a]!.x - pos[b]!.x, pos[a]!.y - pos[b]!.y);

  const adj: { to: number; w: number }[][] = ids.map(() => []);
  for (const [a, b] of roads.edges) {
    const ia = index.get(a)!;
    const ib = index.get(b)!;
    const w = len(ia, ib);
    adj[ia]!.push({ to: ib, w });
    adj[ib]!.push({ to: ia, w });
  }
  // Fixed neighbour order keeps tie-breaking deterministic.
  for (const list of adj) list.sort((p, q) => p.to - q.to);

  const dist: number[][] = [];
  const next: number[][] = [];
  for (let src = 0; src < n; src++) {
    const d = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    d[src] = 0;
    for (let k = 0; k < n; k++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && (u === -1 || d[i]! < d[u]!)) u = i;
      if (u === -1 || d[u] === Infinity) break;
      done[u] = true;
      for (const { to, w } of adj[u]!) {
        if (d[u]! + w < d[to]! - 1e-9) {
          d[to] = d[u]! + w;
          prev[to] = u;
        }
      }
    }
    // Walk back from each target to find the first hop out of src.
    const hop = new Array<number>(n).fill(-1);
    for (let t = 0; t < n; t++) {
      if (t === src) hop[t] = src;
      else if (d[t] !== Infinity) {
        let v = t;
        while (prev[v] !== src) v = prev[v]!;
        hop[t] = v;
      }
    }
    dist.push(d);
    next.push(hop);
  }

  return {
    ids,
    pos,
    index,
    dist,
    next,
    path(a, b) {
      const out = [a];
      while (a !== b) out.push((a = next[a]![b]!));
      return out;
    },
    edgeLength: len,
  };
}
