/**
 * Whether the lines between cards were earned.
 *
 * The analysis prompt used to say "connect the steps in reading order", so any
 * numbered list became a pipeline: 44 real analyses produced 348 sequence edges
 * of which 234 crossed a heading and 127 touched a gate. The picture was not
 * wrong about the prose, it was wrong about execution — `cmdb-assistant` showed
 * "log in" → "session expired" → "search jobs" as a single run, when those are
 * three separate capabilities.
 *
 * The prompt now says an edge must be paid for by output passing or a stated
 * state transition. A prompt is a request, not a guarantee, so this module is
 * the deterministic half: it reads the same `FlowDoc` the page draws and names
 * every connection that could not have been paid for. Findings never fail a
 * build — a genuinely linear skill is allowed to be linear — but a caller can
 * now tell "flows" from "lists with arrows".
 */

import type { FlowDoc, FlowEdge, FlowNode } from './types.ts';

export interface EdgeDefects {
  /** Edges whose either end is a gate. A gate constrains, it is not a step. */
  gateEdges: number;
  /** Sequence edges leaving an artifact: a deliverable ends a run. */
  artifactStems: number;
  /** Decisions with fewer than two ways out, i.e. a fork flattened into a step. */
  flatDecisions: number;
  /** Longest run of executable cards with no artifact, decision or gate ending it. */
  longestRun: number;
  /** Sequence edges that jump between two ordinary `##` sections, rule sections excluded. */
  crossSectionEdges: number;
  /**
   * Of those jumps, the ones carrying a `reason` quoting the source connective.
   *
   * The contract allows a cross-section sequence when the prose states the
   * transition. Counting both kinds together punished the analysis for reading
   * `文档生成后，对金融接口做以下增强检查` correctly: the edge is the author's
   * ordering, and the only defect is a jump nobody paid for.
   */
  justifiedCrossSection: number;
  /** Distinct sections involved in those jumps. */
  crossedSections: string[];
  /** Executable nodes with no execution edge at all, in a graph that has edges. */
  isolatedActions: number;
}

const EXECUTABLE: ReadonlySet<FlowNode['type']> = new Set(['stage', 'external']);

function outgoing(edges: FlowEdge[]): Map<string, FlowEdge[]> {
  const out = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    if (!edge.from || !edge.to) continue;
    const list = out.get(edge.from) ?? [];
    list.push(edge);
    out.set(edge.from, list);
  }
  return out;
}

/**
 * The `##` section a line belongs to, or `pre` for the preamble.
 *
 * Level ≤ 2 on purpose: `###` subsections are usually one capability explained
 * in parts (`4.1 连接管理`), and jumping between those is normal. Jumping
 * between `## 一、规则` and `## 三、执行流程` is not.
 */
function sectionAt(doc: FlowDoc, line: number): FlowDoc['sections'][number] | undefined {
  let current: FlowDoc['sections'][number] | undefined;
  for (const section of doc.sections ?? []) {
    if (section.level <= 2 && section.start <= line) current = section;
  }
  return current;
}

/**
 * A section that states rules rather than steps.
 *
 * `规则` / `门禁` / `红线` blocks are read before whatever they constrain, and an
 * analysis that threads them into the trunk is making the same mistake as
 * threading a gate card into it. The measurement is separate so the count stays
 * honest: on the current library 29 of 136 cross-section edges touch one of
 * these, and 107 do not.
 */
const RULE_SECTION = /规则|门禁|约束|红线|原则|铁律|注意|禁止|必读|不可协商/;

function isRuleSection(section: FlowDoc['sections'][number] | undefined): boolean {
  return section !== undefined && RULE_SECTION.test(section.title);
}

/**
 * The longest chain of executable cards in the graph.
 *
 * Walked over sequence edges only: a branch edge is a fork, which is exactly
 * the thing that is allowed to end a run, and a **branch is not a step**, so it
 * is neither followed nor counted. A card with two ways forward is where the
 * author said "it depends"; whatever follows belongs to one arm, not to the
 * chain. The walk starts from every executable node and follows one successor,
 * so a diamond cannot make one chain look like two.
 */
export function longestActionRun(doc: FlowDoc): { length: number; nodes: FlowNode[] } {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const out = outgoing(doc.edges);
  const next = new Map<string, string>();
  for (const [id, edges] of out) {
    const forward = edges.filter((edge) => edge.kind === 'sequence');
    if (forward.length === 1) next.set(id, forward[0].to);
  }

  let best: FlowNode[] = [];
  for (const node of doc.nodes) {
    if (!EXECUTABLE.has(node.type)) continue;
    const path: FlowNode[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = node.id;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const current = byId.get(cursor);
      if (!current || !EXECUTABLE.has(current.type)) break;
      path.push(current);
      // More than one way forward ends the run at this card: the run is the
      // part with a single next step, not the fork itself.
      if ((out.get(cursor) ?? []).length > 1) break;
      cursor = next.get(cursor);
    }
    if (path.length > best.length) best = path;
  }
  return { length: best.length, nodes: best };
}

export function edgeDefectsOf(doc: FlowDoc): EdgeDefects {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const out = outgoing(doc.edges);

  let gateEdges = 0;
  let artifactStems = 0;
  let crossSectionEdges = 0;
  let justifiedCrossSection = 0;
  const crossed = new Set<string>();
  for (const edge of doc.edges) {
    if (!edge.from || !edge.to) continue;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    if (from.type === 'gate' || to.type === 'gate') gateEdges++;
    if (edge.kind === 'sequence' && from.type === 'artifact') artifactStems++;
    if (edge.kind !== 'sequence') continue;
    const source = sectionAt(doc, from.anchor.start);
    const target = sectionAt(doc, to.anchor.start);
    if (!source || !target || source.id === target.id) continue;
    if (isRuleSection(source) || isRuleSection(target)) continue;
    // A jump the analysis paid for is the author's ordering, not a chapter read
    // as a step. It is still counted, so a reader can see how much of the graph
    // leaves its section — but only the unpaid ones are defects.
    if (edge.reason && edge.reason.trim()) {
      justifiedCrossSection++;
      continue;
    }
    crossSectionEdges++;
    crossed.add(target.title);
  }

  // A decision's ways out are its branch edges plus the branches it declared
  // without a target. `node.branches` already holds both, so one resolved
  // branch plus one open branch is two ways out, not one.
  let flatDecisions = 0;
  for (const node of doc.nodes) {
    if (node.type !== 'decision') continue;
    const sequenceOuts = (out.get(node.id) ?? []).filter((edge) => edge.kind === 'sequence').length;
    const branchOuts = node.branches.length;
    if (sequenceOuts + branchOuts < 2) flatDecisions++;
  }

  const linked = new Set<string>();
  for (const edge of doc.edges) {
    if (!edge.from || !edge.to) continue;
    linked.add(edge.from);
    linked.add(edge.to);
  }
  const isolatedActions = doc.edges.length > 0
    ? doc.nodes.filter((node) => EXECUTABLE.has(node.type) && !linked.has(node.id)).length
    : 0;

  return {
    gateEdges,
    artifactStems,
    flatDecisions,
    longestRun: longestActionRun(doc).length,
    crossSectionEdges,
    justifiedCrossSection,
    crossedSections: [...crossed],
    isolatedActions,
  };
}
