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

/** A graph shaped like the ones the prompt's old "connect in reading order" rule produced. */
function chainDoc(types: Array<'stage' | 'artifact' | 'decision' | 'gate'>, extraEdges: Array<[number, number]> = []) {
  const nodes = types.map((type, i) => ({
    id: `n-${i}`,
    type,
    label: `第 ${i + 1} 张`,
    text: '正文',
    raw: '正文',
    anchor: { heading: [], start: i + 1, end: i + 1, sha: 'x' },
    branches: [],
    confidence: 0.9,
    flags: [],
  }));
  const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id, kind: 'sequence' as const }));
  for (const [from, to] of extraEdges) edges.push({ from: nodes[from].id, to: nodes[to].id, kind: 'sequence' as const });
  return {
    skill: 'chain',
    description: '',
    source: { file: 'SKILL.md', sha: 'x', lines: types.length, generated_at: '2026-11-18T00:00:00.000Z' },
    schema_version: 1 as const,
    nodes,
    edges,
    sections: [],
    stats: { byType: { stage: 0, decision: 0, gate: 0, artifact: 0, external: 0, note: 0 }, lowConfidence: 0, stale: 0, maxDepth: types.length },
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
  const empty = formatDiagnosis({
    findings: [],
    measures: {
      nodes: 0, bands: 0, widestBand: 0, branchEdges: 0, declaredForks: 0, truncatedLabels: 0,
      edges: { gateEdges: 0, artifactStems: 0, flatDecisions: 0, longestRun: 0, crossSectionEdges: 0, crossedSections: [], isolatedActions: 0 },
    },
  });
  assert.equal(empty, '  shape       ok\n');
  const doc = docOf('grill-method.md');
  const text = formatDiagnosis(diagnose(doc));
  assert.ok(text.endsWith('\n'));
  for (const line of text.trimEnd().split('\n')) assert.match(line, /^ {2}/, `"${line}" is not indented under the report`);
});

/*
 * The edge layer. The prompt now says a `sequence` edge has to be paid for by
 * output passing or a stated state transition, but a prompt is a request. These
 * tests pin the half that is deterministic: given the same flow the page draws,
 * name every arrow that could not have been paid for.
 */

test('a gate threaded into the trunk is reported, not silently redrawn', () => {
  const doc = chainDoc(['stage', 'gate', 'stage', 'stage']);
  const diagnosis = diagnose(doc);
  // Two of the three edges touch the gate. A gate is a condition beside an
  // action, so both directions are wrong in the same way.
  assert.equal(diagnosis.measures.edges.gateEdges, 2);
  const finding = diagnosis.findings.find((f) => f.code === 'gate-on-trunk');
  assert.ok(finding, `no finding; got ${diagnosis.findings.map((f) => f.code).join(', ')}`);
  assert.equal(finding.severity, 'warn');
  assert.match(finding.message, /^2 条执行边的一端是门禁/);
});

test('a decision with one way out is reported as a flattened fork', () => {
  const doc = chainDoc(['stage', 'decision', 'stage']);
  const diagnosis = diagnose(doc);
  assert.equal(diagnosis.measures.edges.flatDecisions, 1);
  const finding = diagnosis.findings.find((f) => f.code === 'flat-decision');
  assert.ok(finding, `no finding; got ${diagnosis.findings.map((f) => f.code).join(', ')}`);
  assert.match(finding.message, /^1 个判定节点只有一条出路/);
});

test('two declared branches are enough to make a decision a real fork', () => {
  const doc = chainDoc(['stage', 'decision', 'stage']);
  // One resolved branch plus one open one is two ways out; the open arm is
  // honest, and `forks-not-drawn` is the finding for "none of them landed".
  doc.nodes[1].branches = [{ when: '有证据' }, { when: '没有证据' }];
  assert.equal(diagnose(doc).measures.edges.flatDecisions, 0);
});

test('four actions in a row with no deliverable is a list with arrows', () => {
  const doc = chainDoc(['stage', 'stage', 'stage', 'stage', 'artifact']);
  const diagnosis = diagnose(doc);
  assert.equal(diagnosis.measures.edges.longestRun, 4);
  const finding = diagnosis.findings.find((f) => f.code === 'endless-action-run');
  assert.ok(finding, `no finding; got ${diagnosis.findings.map((f) => f.code).join(', ')}`);
  // Four is worth saying, six is worth fixing: the agent-dev-standards chain was
  // eight steps long and every one of them was a different state.
  assert.equal(finding.severity, 'info');
  assert.match(finding.message, /连续 4 个动作/);

  const long = chainDoc(['stage', 'stage', 'stage', 'stage', 'stage', 'stage', 'artifact']);
  assert.equal(diagnose(long).findings.find((f) => f.code === 'endless-action-run')?.severity, 'warn');
});

test('a short run is allowed: three actions then a deliverable is a normal procedure', () => {
  const doc = chainDoc(['stage', 'stage', 'stage', 'artifact']);
  assert.equal(diagnose(doc).measures.edges.longestRun, 3);
  assert.equal(diagnose(doc).findings.some((f) => f.code === 'endless-action-run'), false);
});

test('an artifact that continues the line is reported, because a deliverable ends the run', () => {
  const doc = chainDoc(['stage', 'artifact', 'stage']);
  const diagnosis = diagnose(doc);
  assert.equal(diagnosis.measures.edges.artifactStems, 1);
  assert.ok(diagnosis.findings.some((f) => f.code === 'artifact-does-not-continue'));
});

test('a sequence edge that jumps a ## section is reported, and a jump out of a rule section is not', () => {
  const doc = chainDoc(['stage', 'stage', 'stage']);
  doc.sections = [
    { id: 's0', title: '一、规则（不可协商）', level: 2, start: 1 },
    { id: 's1', title: '二、执行流程', level: 2, start: 2 },
    { id: 's2', title: '三、输出格式', level: 2, start: 3 },
  ];
  const diagnosis = diagnose(doc);
  // 1→2 leaves the rule section (allowed: the rules govern what follows), 2→3
  // crosses two ordinary sections, which is a parallel chapter, not a step.
  assert.equal(diagnosis.measures.edges.crossSectionEdges, 1);
  const finding = diagnosis.findings.find((f) => f.code === 'cross-section-sequence');
  assert.ok(finding, `no finding; got ${diagnosis.findings.map((f) => f.code).join(', ')}`);
  assert.deepEqual(diagnosis.measures.edges.crossedSections, ['三、输出格式']);
  assert.match(finding.message, /^1 条顺序边跨了 ## 小节/);
});

test('an isolated action is reported once the graph has edges to be isolated from', () => {
  const doc = chainDoc(['stage', 'stage']);
  doc.nodes.push({
    id: 'n-alone', type: 'external', label: '另一条支线', text: '正文', raw: '正文',
    anchor: { heading: [], start: 3, end: 3, sha: 'x' }, branches: [], confidence: 0.9, flags: [],
  });
  assert.equal(diagnose(doc).measures.edges.isolatedActions, 1);

  const noEdges = chainDoc(['stage', 'stage']);
  noEdges.edges = [];
  assert.equal(diagnose(noEdges).measures.edges.isolatedActions, 0, 'an edge-less graph is not six isolated nodes');
});

test('a cross-section jump the analysis paid for is counted, not condemned', () => {
  // `api-doc-generator` says `文档生成后，做以下增强检查`: the source orders the two
  // chapters, and quoting that sentence is the whole evidence. Counting it with
  // the invented jumps made a correct reading look like a defect.
  const doc = chainDoc(['stage', 'stage', 'stage']);
  doc.sections = [
    { id: 's0', title: '一、执行流程', level: 2, start: 1 },
    { id: 's1', title: '二、合规增强', level: 2, start: 3 },
  ];
  // 1→2 is inside the first chapter (starts at 1); 2→3 is the jump.
  doc.edges[1] = { ...doc.edges[1], reason: '「文档生成后」把两章排成一个顺序' };
  const diagnosis = diagnose(doc);
  assert.equal(diagnosis.measures.edges.crossSectionEdges, 0, 'a paid jump was counted as a defect');
  assert.equal(diagnosis.measures.edges.justifiedCrossSection, 1);
  const codes = diagnosis.findings.map((f) => f.code);
  assert.equal(codes.includes('cross-section-sequence' as never), false);
  const justified = diagnosis.findings.find((f) => f.code === 'cross-section-justified');
  assert.ok(justified, `no finding; got ${codes.join(', ')}`);
  assert.equal(justified.severity, 'info', 'a paid jump is a number, not a warning');
});

test('a graph with earned edges produces none of the edge findings', () => {
  // Two state-machine steps, a decision with two branches, a deliverable that
  // ends the run, and no crossings: this is the shape the prompt now asks for.
  const doc = chainDoc(['stage', 'decision', 'artifact']);
  doc.nodes[1].branches = [{ when: '命中', to: 'n-2' }, { when: '未命中' }];
  doc.edges = [
    { from: 'n-0', to: 'n-1', kind: 'sequence' },
    { from: 'n-1', to: 'n-2', kind: 'branch', when: '命中' },
  ];
  const codes = diagnose(doc).findings.map((f) => f.code);
  for (const code of ['gate-on-trunk', 'flat-decision', 'artifact-does-not-continue', 'cross-section-sequence']) {
    assert.equal(codes.includes(code as never), false, `${code} fired on a well-formed graph: ${codes.join(', ')}`);
  }
});
