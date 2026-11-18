/**
 * How many sequence steps deep a node sits.
 *
 * Longest path, not shortest: a node should sit below everything that can reach
 * it, otherwise two edges into the same band cross the card. The relaxation is
 * capped at `nodes.length` passes, so a cycle in the source degrades to a
 * stable answer instead of hanging the renderer.
 *
 * Both `stats.maxDepth` and the layout read this. They used to disagree:
 * `maxDepth` was the heading nesting depth, so a 19-step pipeline reported 2
 * while the canvas drew 19 bands.
 */

import type { FlowEdge, FlowNode } from './types.ts';

export function depthOf(nodes: FlowNode[], edges: FlowEdge[]): Map<string, number> {
  const preds = new Map<string, string[]>();
  for (const node of nodes) preds.set(node.id, []);
  for (const edge of edges) {
    if (edge.kind !== 'sequence') continue;
    if (!preds.has(edge.to) || !preds.has(edge.from)) continue;
    preds.get(edge.to)?.push(edge.from);
  }

  const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const node of nodes) {
      for (const pred of preds.get(node.id) ?? []) {
        const candidate = (depth.get(pred) ?? 0) + 1;
        if (candidate > (depth.get(node.id) ?? 0) && candidate < nodes.length) {
          depth.set(node.id, candidate);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return depth;
}

/** The deepest band index, i.e. how many sequential steps the longest chain has. */
export function maxDepthOf(nodes: FlowNode[], edges: FlowEdge[]): number {
  const depth = depthOf(nodes, edges);
  let max = 0;
  for (const value of depth.values()) max = Math.max(max, value);
  return nodes.length === 0 ? 0 : max + 1;
}
