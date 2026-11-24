/**
 * Batch audit. "Annotate any skill" is only a claim until it has been run over
 * a whole real library, so this walks every root, extracts every skill, and
 * ranks them by how badly the extractor read them. It is a product command, not
 * a dev tool: the question "which of my skills render badly?" is the question
 * the tool exists to answer.
 */

import { readFile } from 'node:fs/promises';

import { discoverSkills, type RootSpec } from './discover.ts';
import { buildFlow } from './flow.ts';
import { parseSkill } from './parse.ts';
import { edgeDefectsOf } from './shape.ts';
import type { FlowDoc } from './types.ts';

export interface SkillAudit {
  skill: string;
  file: string;
  nodes: number;
  edges: number;
  /** Nodes the extractor was not sure about. */
  lowConfidence: number;
  /** Branch labels whose target could not be resolved. */
  unresolvedBranches: number;
  /** Nodes that carry no prose — usually a table or a fence that got split. */
  emptyText: number;
  /** Labels that are pure punctuation or markdown furniture. */
  junkLabels: number;
  /** Nodes per source line: values far above 1 mean the file was over-split. */
  density: number;
  /** Explanatory prose that has no supported node or Skill-wide target. */
  orphanNotes: number;
  noteCount: number;
  associatedNotes: number;
  globalNotes: number;
  /** orphanNotes / noteCount. A navigation signal, not a standalone quality score. */
  orphanTextRate: number;
  /** Arrows that could not have been earned; see {@link edgeDefectsOf}. */
  gateEdges: number;
  artifactStems: number;
  flatDecisions: number;
  crossSectionEdges: number;
  longestRun: number;
  /** Higher is worse. This remains extraction readability, not content efficacy. */
  score: number;
  byType: Record<string, number>;
  sample: string[];
}

const JUNK = /^[|\-:—–\s]*$/;

/**
 * The one place the defect weights live.
 *
 * Two caller-facing numbers used to be computed from two different sets of
 * constants: `audit` said higher-is-worse, the artifact's rail said
 * higher-is-better, and neither could be argued with because they disagreed.
 * Both now read this, so a weight can be changed once and both answers move.
 */
export interface Defects {
  lowConfidence: number;
  unresolvedBranches: number;
  emptyText: number;
  junkLabels: number;
  /** Nodes per source line: values far above 0.5 mean the file was over-split. */
  density: number;
  /** Edges that could not have been earned (gate in the trunk, flattened fork, …). */
  unearnedEdges: number;
  /** Higher is worse. Zero means "nothing the extractor did is visibly broken". */
  score: number;
}

export function defectsOf(doc: FlowDoc, lines: number): Defects {
  const lowConfidence = doc.nodes.filter((n) => n.flags.includes('low-confidence')).length;
  const unresolvedBranches = doc.nodes.reduce((sum, n) => sum + n.branches.filter((b) => !b.to).length, 0);
  const emptyText = doc.nodes.filter((n) => n.text.trim().length === 0).length;
  const junkLabels = doc.nodes.filter((n) => JUNK.test(n.label) || n.label.trim().length === 0).length;
  const density = lines > 0 ? doc.nodes.length / lines : 0;
  const edges = edgeDefectsOf(doc);
  const unearnedEdges = edges.gateEdges + edges.flatDecisions + edges.crossSectionEdges;

  // Weighted so that a single junk label outranks several uncertain ones: a
  // blank box on the canvas is a visible bug, a low confidence is a hint. An
  // unearned edge sits just under those: the picture is legible, the flow is
  // not, and a wrong arrow is worse than a doubtful card.
  const score =
    junkLabels * 10 +
    emptyText * 5 +
    unearnedEdges * 2 +
    unresolvedBranches * 2 +
    lowConfidence +
    Math.max(0, density - 0.5) * 20;

  return { lowConfidence, unresolvedBranches, emptyText, junkLabels, density, unearnedEdges, score };
}

export function auditFlow(doc: FlowDoc, lines: number): Omit<SkillAudit, 'skill' | 'file'> {
  const defects = defectsOf(doc, lines);
  const edges = edgeDefectsOf(doc);
  const coverage = doc.stats.noteCoverage ?? { total: 0, associated: 0, global: 0, unbound: 0, orphanTextRate: 0 };
  return {
    nodes: doc.nodes.length,
    edges: doc.edges.length,
    ...defects,
    gateEdges: edges.gateEdges,
    artifactStems: edges.artifactStems,
    flatDecisions: edges.flatDecisions,
    crossSectionEdges: edges.crossSectionEdges,
    longestRun: edges.longestRun,
    orphanNotes: coverage.unbound,
    noteCount: coverage.total,
    associatedNotes: coverage.associated,
    globalNotes: coverage.global,
    orphanTextRate: coverage.orphanTextRate,
    byType: countByType(doc),
    sample: doc.nodes.filter((n) => n.flags.includes('orphan-note')).slice(0, 3).map((n) => n.label.slice(0, 40)),
  };
}

function countByType(doc: FlowDoc): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(doc.stats.byType)) if (count > 0) out[key] = count as number;
  return out;
}

export async function auditRoots(roots: RootSpec[]): Promise<{ audits: SkillAudit[]; skipped: Array<{ root: string; reason: string }> }> {
  const { skills, skipped } = await discoverSkills(roots);
  const audits: SkillAudit[] = [];

  for (const ref of skills) {
    let text: string;
    try {
      text = await readFile(ref.file, 'utf8');
    } catch {
      skipped.push({ root: ref.file, reason: 'unreadable' });
      continue;
    }
    const skill = parseSkill(text);
    const doc = buildFlow(skill, text, { sourceFile: 'SKILL.md' });
    audits.push({ skill: ref.name, file: ref.file, ...auditFlow(doc, skill.totalLines) });
  }

  audits.sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill));
  return { audits, skipped };
}

export function formatAudit(input: SkillAudit[], limit = 20): string {
  if (input.length === 0) return '未发现任何 skill\n';

  // Sort here rather than trusting the caller: the whole value of this report
  // is that the worst row is on top, and a mis-ordered table reads as "all fine".
  const audits = [...input].sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill));
  const clean = audits.filter((a) => a.score === 0).length;
  const out: string[] = [];
  out.push(`${audits.length} 个 skill，${clean} 个零瑕疵\n`);
  out.push(`${'score'.padStart(6)}  ${'nodes'.padStart(5)}  ${'low'.padStart(3)}  ${'unres'.padStart(5)}  ${'junk'.padStart(4)}  ${'edges'.padStart(5)}  ${'orphan'.padStart(6)}  skill`);

  for (const a of audits.slice(0, limit)) {
    out.push(
      `${a.score.toFixed(1).padStart(6)}  ${String(a.nodes).padStart(5)}  ${String(a.lowConfidence).padStart(3)}  ` +
        `${String(a.unresolvedBranches).padStart(5)}  ${String(a.junkLabels).padStart(4)}  ` +
        `${String(a.gateEdges + a.flatDecisions + a.crossSectionEdges).padStart(5)}  ${`${Math.round(a.orphanTextRate * 100)}%`.padStart(6)}  ${a.skill}`,
    );
    if (a.junkLabels > 0 || a.emptyText > 0) {
      out.push(`        样本：${a.sample.join(' | ')}`);
    }
  }
  if (audits.length > limit) out.push(`  … 另有 ${audits.length - limit} 个未列出`);
  return `${out.join('\n')}\n`;
}
