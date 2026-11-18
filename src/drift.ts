/**
 * Drift is the failure mode that makes this class of tool untrustworthy: a
 * graph that looks right while the skill underneath it changed. Annot treats
 * a node as valid only while the exact lines it was lifted from still hash to
 * the same value, and reports anything else instead of quietly re-guessing.
 */

import { linesSha, type RawLine } from './parse.ts';
import type { DriftReport, FlowDoc, FlowNode } from './types.ts';

export interface DriftOutcome extends DriftReport {
  nodes: FlowNode[];
}

export function detectDrift(doc: FlowDoc, currentText: string): DriftOutcome {
  const lines: RawLine[] = currentText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((text, i) => ({ n: i + 1, text }));

  const stale: DriftReport['stale'] = [];
  const nodes = doc.nodes.map((node) => ({ ...node, flags: [...node.flags] }));

  for (const node of nodes) {
    const span = node.anchor.end - node.anchor.start + 1;
    // Capture the original position first: the relocation steps below rewrite
    // `node.anchor`, and reading `from` after that reported "moved 65 → 65".
    const was = node.anchor.start;
    const window = lines.slice(node.anchor.start - 1, node.anchor.start - 1 + span);
    if (window.length === span && linesSha(window) === node.anchor.sha) continue;

    const exact = findExact(lines, span, node.anchor.sha, node.anchor.start);
    if (exact !== undefined) {
      node.anchor = { ...node.anchor, start: exact, end: exact + span - 1 };
      node.flags.push('relocated');
      stale.push({ id: node.id, label: node.label, reason: 'moved', from: was, to: exact });
      continue;
    }

    // Nothing matches exactly, but the lines in the original window still share
    // most of their words with the node: the edit happened *here*, in place.
    // Reporting that as `broken` made every successful rewrite look like data
    // loss, which is the opposite of what the check is for.
    const inPlace = similarity(normalize(node.raw), normalize(window.map((l) => l.text).join(' ')));
    if (inPlace >= 0.4) {
      node.flags.push('relocated');
      stale.push({ id: node.id, label: node.label, reason: 'edited', from: was, to: was });
      continue;
    }

    const near = findSimilar(lines, span, node.raw, was);
    if (near !== undefined) {
      node.anchor = { ...node.anchor, start: near.start, end: near.start + span - 1 };
      node.flags.push('relocated');
      stale.push({ id: node.id, label: node.label, reason: 'moved', from: was, to: near.start });
      continue;
    }

    node.flags.push('stale');
    stale.push({ id: node.id, label: node.label, reason: 'broken', from: was });
  }

  return { skill: doc.skill, ok: stale.length === 0, stale, nodes };
}

function findExact(lines: RawLine[], span: number, sha: string, near: number): number | undefined {
  const order = byDistance(lines.length - span + 1, near);
  for (const start of order) {
    const window = lines.slice(start - 1, start - 1 + span);
    if (window.length === span && linesSha(window) === sha) return start;
  }
  return undefined;
}

function findSimilar(
  lines: RawLine[],
  span: number,
  raw: string,
  near: number,
): { start: number; score: number } | undefined {
  const target = normalize(raw);
  if (!target) return undefined;
  let best: { start: number; score: number } | undefined;
  for (const start of byDistance(lines.length - span + 1, near)) {
    const window = lines.slice(start - 1, start - 1 + span);
    const score = similarity(target, normalize(window.map((l) => l.text).join(' ')));
    if (score >= 0.62 && (!best || score > best.score)) best = { start, score };
  }
  return best;
}

/** Nearest-first scan: an edit usually moves a node by a few lines, not hundreds. */
function* byDistance(count: number, near: number): Generator<number> {
  if (count <= 0) return;
  const clamped = Math.min(Math.max(1, near), count);
  yield clamped;
  for (let d = 1; d < count; d++) {
    if (clamped - d >= 1) yield clamped - d;
    if (clamped + d <= count) yield clamped + d;
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const at = new Set(a.split(' '));
  const bt = new Set(b.split(' '));
  let hit = 0;
  for (const t of at) if (bt.has(t)) hit++;
  return hit / Math.max(at.size, bt.size);
}
