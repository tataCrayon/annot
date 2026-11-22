/**
 * The geometry cannot fail a rendering, but it can fail to be a flow.
 *
 * `verify` proves the page drew: no overflow, every node present, no network.
 * Three real skills passed all of that while drawing one card per band and zero
 * branch edges, so the picture was a numbered list. Nothing judged the shape.
 * These tests pin the judgement, including the case where it must stay silent.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { diagnose, formatDiagnosis } from '../src/diag.ts';
import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';

const here = dirname(fileURLToPath(import.meta.url));

function docOf(file: string) {
  const text = readFileSync(join(here, 'fixtures', file), 'utf8');
  return buildFlow(parseSkill(text, { file }), text, { sourceFile: file });
}

/**
 * A synthetic linear skill: ten steps, no judgment anywhere.
 *
 * Built rather than read from a fixture because the finding is about shape, and
 * a fixture would drift into testing the extractor instead. `agent-dev-standards`
 * produces this shape for real (19 nodes, 19 bands, 0 decisions), and it passed
 * every viewport check while reading as a numbered list.
 */
function linearDoc(steps = 10) {
  const nodes = Array.from({ length: steps }, (_, i) => ({
    id: `n-step-${i}`,
    type: 'stage' as const,
    label: `第 ${i + 1} 步`,
    text: '正文',
    raw: '正文',
    anchor: { heading: [], start: i + 1, end: i + 1, sha: 'x' },
    branches: [],
    confidence: 0.65,
    flags: [],
  }));
  return {
    skill: 'linear',
    description: '',
    source: { file: 'SKILL.md', sha: 'x', lines: steps, generated_at: '2026-11-18T00:00:00.000Z' },
    schema_version: 1 as const,
    nodes,
    edges: nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id, kind: 'sequence' as const })),
    sections: [],
    stats: { byType: { stage: steps, decision: 0, gate: 0, artifact: 0, external: 0, note: 0 }, lowConfidence: 0, stale: 0, maxDepth: steps },
  };
}

test('a declared fork with no branch edge is reported as a defect', () => {
  const doc = docOf('grill-method.md');
  const diagnosis = diagnose(doc);
  // grill-method declares 守住 / 改良 / 替换 and bound none of them. The picture
  // shows three open arms, which is honest, but the flow is still broken.
  assert.ok(diagnosis.measures.declaredForks > 0);
  assert.equal(diagnosis.measures.branchEdges, 0);
  const finding = diagnosis.findings.find((f) => f.code === 'forks-not-drawn');
  assert.ok(finding, `no finding; got ${diagnosis.findings.map((f) => f.code).join(', ')}`);
  assert.equal(finding.severity, 'warn');
  assert.match(finding.message, /\d+ 个分支/);
});

test('a long single-column graph with no decision is reported', () => {
  const doc = linearDoc();
  const diagnosis = diagnose(doc);
  assert.equal(diagnosis.measures.widestBand, 1);
  const finding = diagnosis.findings.find((f) => f.code === 'single-column');
  assert.ok(finding, `no finding; got ${diagnosis.findings.map((f) => f.code).join(', ')}`);
  // The exact numbers are the point: "looks like a list" is not a diagnosis.
  assert.match(finding.message, /^10 个节点排成 10 条单卡带/);
  assert.equal(finding.severity, 'warn');
});

test('a short linear skill is allowed to be linear', () => {
  const diagnosis = diagnose(linearDoc(4));
  assert.equal(
    diagnosis.findings.some((f) => f.code === 'single-column'),
    false,
    'a four-step pipeline was called a list',
  );
});

test('the formatted diagnosis always ends with a newline and never invents a line', () => {
  const empty = formatDiagnosis({ findings: [], measures: { nodes: 0, bands: 0, widestBand: 0, branchEdges: 0, declaredForks: 0, truncatedLabels: 0 } });
  assert.equal(empty, '  shape       ok\n');
  const doc = docOf('grill-method.md');
  const text = formatDiagnosis(diagnose(doc));
  assert.ok(text.endsWith('\n'));
  for (const line of text.trimEnd().split('\n')) assert.match(line, /^ {2}/, `"${line}" is not indented under the report`);
});
