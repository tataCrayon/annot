/**
 * The audit is the command that answers "which of my skills render badly?".
 * Its ranking has to be trustworthy in one specific way: a skill the extractor
 * read cleanly must score exactly zero, and anything visibly broken must rank
 * above it. These tests pin that ordering rather than exact numbers, because
 * the weights are a judgement call but the ordering is the contract.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditFlow, formatAudit, type SkillAudit } from '../src/audit.ts';
import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';
import type { FlowDoc, FlowNode } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

function node(over: Partial<FlowNode>): FlowNode {
  return {
    id: 'n-x',
    type: 'stage',
    label: 'a real step',
    text: 'a real step',
    raw: 'a real step',
    anchor: { heading: [], start: 1, end: 1, sha: 'a'.repeat(64) },
    branches: [],
    confidence: 0.8,
    flags: [],
    ...over,
  };
}

function doc(nodes: FlowNode[]): FlowDoc {
  return {
    skill: 'x',
    description: '',
    source: { file: 'SKILL.md', sha: 'a'.repeat(64), lines: 40, generated_at: 'now' },
    schema_version: 1,
    nodes,
    edges: [],
    associations: [],
    sections: [],
    stats: { byType: { stage: nodes.length, decision: 0, gate: 0, artifact: 0, external: 0, note: 0 }, lowConfidence: 0, stale: 0, maxDepth: 0, noteCoverage: { total: 0, associated: 0, global: 0, unbound: 0, coverageRate: 1, orphanTextRate: 0 } },
  };
}

async function realAudit(name: string) {
  const text = await readFile(join(here, 'fixtures', name), 'utf8');
  const skill = parseSkill(text);
  return auditFlow(buildFlow(skill, text, { sourceFile: 'SKILL.md' }), skill.totalLines);
}

test('a well-formed skill has no visible defects and a low score', async () => {
  const a = await realAudit('router-shape.md');
  assert.equal(a.junkLabels, 0, `junk labels: ${a.sample.join(' | ')}`);
  assert.equal(a.emptyText, 0);
  assert.equal(a.density <= 0.5, true, `over-split: ${a.nodes} nodes for the file`);
  // Zero would be wrong here: a real skill does contain hints (one uncertain
  // node, one branch the extractor could not bind). The contract is that the
  // *visible* defects are absent and the score stays well under a broken one.
  assert.ok(a.score < 10, `clean skill scored ${a.score}`);
});

test('a junk label outranks a merely uncertain node', () => {
  const uncertain = auditFlow(doc([node({ flags: ['low-confidence'] })]), 40);
  const junk = auditFlow(doc([node({ label: '|---|', text: '' })]), 40);
  assert.ok(uncertain.score > 0);
  assert.ok(junk.score > uncertain.score, `junk ${junk.score} should beat uncertain ${uncertain.score}`);
});

test('an unearned edge is a defect the audit can rank, not just a shape note', () => {
  const gate = node({ id: 'n-gate', type: 'gate', anchor: { heading: [], start: 2, end: 2, sha: 'a'.repeat(64) } });
  const step = node({ id: 'n-step', anchor: { heading: [], start: 1, end: 1, sha: 'a'.repeat(64) } });
  const chained = doc([step, gate]);
  chained.edges = [{ from: 'n-step', to: 'n-gate', kind: 'sequence' }];

  const a = auditFlow(chained, 40);
  assert.equal(a.gateEdges, 1);
  assert.ok(a.score > 0, 'a gate threaded into the trunk scored zero');
  // Still below a junk label: a wrong arrow is a flow defect, a blank box is a
  // rendering defect, and the ranking has to say which is worse.
  const junk = auditFlow(doc([node({ label: '|---|', text: '' })]), 40);
  assert.ok(a.score < junk.score, `unearned edge ${a.score} should rank below junk ${junk.score}`);
});

test('unresolved branches are counted per branch, not per node', () => {
  const a = auditFlow(
    doc([node({ branches: [{ when: 'x' }, { when: 'y' }, { when: 'z', to: 'n-ok' }] })]),
    40,
  );
  assert.equal(a.unresolvedBranches, 2);
});

test('over-splitting is penalised: one node per line is suspicious', () => {
  const dense = doc(Array.from({ length: 40 }, (_, i) => node({ id: `n-${i}`, anchor: { heading: [], start: i + 1, end: i + 1, sha: 'a'.repeat(64) } })));
  const a = auditFlow(dense, 40);
  assert.ok(a.score > 0, 'one node per source line should not score zero');
});

test('formatAudit lists worst first and states the clean count', () => {
  const rows: SkillAudit[] = [
    { skill: 'good', file: 'g', nodes: 5, edges: 4, lowConfidence: 0, unresolvedBranches: 0, emptyText: 0, junkLabels: 0, density: 0.05, orphanNotes: 0, noteCount: 0, associatedNotes: 0, globalNotes: 0, orphanTextRate: 0, score: 0, byType: {}, sample: [] },
    { skill: 'bad', file: 'b', nodes: 9, edges: 8, lowConfidence: 3, unresolvedBranches: 2, emptyText: 1, junkLabels: 1, density: 0.9, orphanNotes: 2, noteCount: 4, associatedNotes: 2, globalNotes: 0, orphanTextRate: 0.5, score: 23, byType: {}, sample: ['|---|'] },
  ];
  const out = formatAudit(rows, 10);
  assert.match(out, /2 个 skill，1 个零瑕疵/);
  assert.ok(out.indexOf('bad') < out.indexOf('good'), 'worst row must print first');
  assert.match(out, /样本：/);
  assert.match(out, /orphan/);
  assert.match(out, /50%/);
});

test('an empty library reports so instead of printing nothing', () => {
  assert.match(formatAudit([]), /未发现任何 skill/);
});
