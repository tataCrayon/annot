/**
 * What the geometry cannot say about itself.
 *
 * `verify` proves the page rendered: no overflow, every node drawn, no network.
 * It cannot prove the picture is a *flow* — three real skills scored `widest 1`
 * on every band, drew zero branch edges while declaring three forks, and passed
 * every viewport check. Nothing was wrong with the rendering; there was no fork
 * to render.
 *
 * A diagnosis is therefore a statement about the extraction, phrased so it can
 * be argued with: each finding names the count it saw and what that count
 * implies. Findings never fail a build — a linear skill is allowed to be linear
 * — but a caller that asked whether the graph shows a decision can now tell.
 *
 * The same test applies one layer down, to the arrows. A `sequence` edge is
 * supposed to mean "this produces what that consumes, or the same state machine
 * moves on". The prompt now asks for that, and 40 shipped analyses showed 348
 * edges of which 127 touched a gate and 136 jumped a `##` section — the prompt
 * asked and was ignored, exactly as expected. The findings below are the
 * deterministic half: they read the same `FlowDoc` the page draws and name every
 * arrow that could not have been earned.
 */

import { depthOf } from './depth.ts';
import { edgeDefectsOf, longestActionRun, type EdgeDefects } from './shape.ts';
import type { FlowDoc, FlowNode } from './types.ts';

export type Severity = 'info' | 'warn';

export type FindingCode =
  | 'forks-not-drawn'
  | 'single-column'
  | 'stage-dominated'
  | 'labels-truncated'
  | 'over-split'
  | 'gate-on-trunk'
  | 'flat-decision'
  | 'endless-action-run'
  | 'artifact-does-not-continue'
  | 'cross-section-sequence'
  | 'isolated-action';

export interface Finding {
  /** Stable, so a caller can filter without matching prose. */
  code: FindingCode;
  severity: Severity;
  message: string;
}

export interface Diagnosis {
  findings: Finding[];
  /** The numbers the findings were derived from, so a reader can check them. */
  measures: {
    nodes: number;
    bands: number;
    widestBand: number;
    branchEdges: number;
    declaredForks: number;
    truncatedLabels: number;
    /** Edge-level counts; see {@link EdgeDefects}. */
    edges: EdgeDefects;
  };
}

/** A label the extractor cut mid-phrase always ends in the ellipsis it added. */
function isTruncated(label: string): boolean {
  return label.endsWith('…');
}

export function diagnose(doc: FlowDoc): Diagnosis {
  const depth = depthOf(doc.nodes, doc.edges);
  const perBand = new Map<number, number>();
  for (const node of doc.nodes) {
    const band = depth.get(node.id) ?? 0;
    perBand.set(band, (perBand.get(band) ?? 0) + 1);
  }

  const declaredForks = doc.nodes.reduce((total, node) => total + node.branches.length, 0);
  const branchEdges = doc.edges.filter((edge) => edge.kind === 'branch').length;
  const truncatedLabels = doc.nodes.filter((node) => isTruncated(node.label)).length;
  const widestBand = Math.max(0, ...perBand.values());
  const bands = perBand.size;
  const nodes = doc.nodes.length;

  const findings: Finding[] = [];

  if (declaredForks > 0 && branchEdges === 0) {
    findings.push({
      code: 'forks-not-drawn',
      severity: 'warn',
      message: `文件里写了 ${declaredForks} 个分支，一条都没连到目标；图上只能看到未落地的臂。`,
    });
  }

  // A flow with only one card per band is a numbered list. That is legitimate
  // for a short linear skill, so the threshold is both "long" and "no decision":
  // eight steps with no judgment anywhere is the signature of prose being read
  // as a pipeline.
  if (nodes >= 8 && widestBand === 1 && doc.stats.byType.decision === 0) {
    findings.push({
      code: 'single-column',
      severity: 'warn',
      message: `${nodes} 个节点排成 ${bands} 条单卡带，且没有任何判定节点：这张图读起来是清单，不是流程。`,
    });
  }

  const stageShare = nodes > 0 ? doc.stats.byType.stage / nodes : 0;
  if (nodes >= 6 && stageShare >= 0.8) {
    findings.push({
      code: 'stage-dominated',
      severity: 'info',
      message: `${Math.round(stageShare * 100)}% 的节点是兜底的 stage 类型，分类基本没有发生。`,
    });
  }

  if (truncatedLabels > 0) {
    findings.push({
      code: 'labels-truncated',
      severity: 'info',
      message: `${truncatedLabels} 个标签在句中截断（以 … 结尾），卡片上读到的是半句话。`,
    });
  }

  const density = doc.source.lines > 0 ? nodes / doc.source.lines : 0;
  if (density > 1) {
    findings.push({
      code: 'over-split',
      severity: 'warn',
      message: `每行切出 ${density.toFixed(2)} 个节点，切得比原文还碎。`,
    });
  }

  // The edge layer: an arrow means "this produces what that consumes, or the
  // same state machine moves on". Everything below is a way an arrow fails to
  // mean that. A prompt asks the model for it; these findings check it.
  const edges = edgeDefectsOf(doc);

  if (edges.gateEdges > 0) {
    findings.push({
      code: 'gate-on-trunk',
      severity: 'warn',
      message: `${edges.gateEdges} 条执行边的一端是门禁。门禁是挂在动作旁的约束，不是工序；应改成 constrains 关联。`,
    });
  }

  if (edges.flatDecisions > 0) {
    findings.push({
      code: 'flat-decision',
      severity: 'warn',
      message: `${edges.flatDecisions} 个判定节点只有一条出路，分叉被压平成了步骤；要么补 branch/openBranches，要么改成 stage。`,
    });
  }

  // Four in a row with no artifact, judgment or gate between them is the shape
  // a numbered list takes when every line is connected to the next. Three is
  // allowed: real procedures do have short runs.
  if (edges.longestRun >= 4) {
    const run: FlowNode[] = longestActionRun(doc).nodes;
    findings.push({
      code: 'endless-action-run',
      severity: edges.longestRun >= 6 ? 'warn' : 'info',
      message: `连续 ${edges.longestRun} 个动作没有任何产出、判定或门禁收尾：${run.slice(0, 4).map((node) => node.label.slice(0, 12)).join(' → ')}${run.length > 4 ? ' → …' : ''}`,
    });
  }

  if (edges.artifactStems > 0) {
    findings.push({
      code: 'artifact-does-not-continue',
      severity: 'info',
      message: `${edges.artifactStems} 条执行边从产物出发。产物是这一串动作的终点，再指出下一步会把交付物伪装成工序。`,
    });
  }

  if (edges.crossSectionEdges > 0) {
    const titles = edges.crossedSections.slice(0, 3).map((title) => title.slice(0, 14)).join(' / ');
    findings.push({
      code: 'cross-section-sequence',
      severity: 'warn',
      message: `${edges.crossSectionEdges} 条顺序边跨了 ## 小节（进入 ${titles}${edges.crossedSections.length > 3 ? ' 等' : ''}）；并列的能力或文档章节被画成了先后。`,
    });
  }

  if (edges.isolatedActions > 0) {
    findings.push({
      code: 'isolated-action',
      severity: 'info',
      message: `${edges.isolatedActions} 个动作没有任何执行边，图上看不出它接在哪一步，也看不出它能独立执行。`,
    });
  }

  return {
    findings,
    measures: { nodes, bands, widestBand, branchEdges, declaredForks, truncatedLabels, edges },
  };
}

export function formatDiagnosis(diagnosis: Diagnosis): string {
  if (diagnosis.findings.length === 0) return '  shape       ok\n';
  return diagnosis.findings.map((f) => `  ${f.severity === 'warn' ? '!' : '·'} ${f.message}`).join('\n') + '\n';
}
