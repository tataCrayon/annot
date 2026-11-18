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
 */

import { depthOf } from './depth.ts';
import type { FlowDoc } from './types.ts';

export type Severity = 'info' | 'warn';

export interface Finding {
  /** Stable, so a caller can filter without matching prose. */
  code: 'forks-not-drawn' | 'single-column' | 'stage-dominated' | 'labels-truncated' | 'over-split';
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

  return {
    findings,
    measures: { nodes, bands, widestBand, branchEdges, declaredForks, truncatedLabels },
  };
}

export function formatDiagnosis(diagnosis: Diagnosis): string {
  if (diagnosis.findings.length === 0) return '  shape       ok\n';
  return diagnosis.findings.map((f) => `  ${f.severity === 'warn' ? '!' : '·'} ${f.message}`).join('\n') + '\n';
}
