import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildFlowFromAnalysis, parseAnalysisProposal } from '../src/analysis.ts';
import { bindConstraints } from '../src/constraints.ts';
import { parseSkill } from '../src/parse.ts';
import { layoutNodes } from '../src/render.ts';

/**
 * A rule without an owner was the visible defect: `account-research`'s first
 * screen was a 门禁 card floating over an empty row, and the header read "0
 * 已关联" while five rules stood on the canvas. The page cannot repair that after
 * the fact — by the time it lays anything out, "which action does this rule
 * govern" has to have an answer.
 */

const SOURCE = [
  '# Demo',
  '',
  '## 硬信念',
  '',
  '1. 判决必须落地，未取证不等于没问题。',
  '',
  '## 流程',
  '',
  '### Step 1: DATA —— 公开数据取证',
  '',
  '按页面类型采集，图片走 OCR。',
  '',
  '### Step 2: 拆解',
  '',
  '单账号深拆：定位 / 选题 / 结构 / 变现四层。',
  '',
  '## 交付前',
  '',
  '交付前必须核对判决是否落地。',
  '',
  '## 输出',
  '',
  '输出《拆解报告》。',
].join('\n');

function proposalFor(text: string) {
  const lines = text.split('\n');
  const line = (needle: string) => lines.findIndex((value) => value.includes(needle)) + 1;
  const node = (id: string, type: string, needle: string, span = 1, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: needle,
    start: line(needle),
    end: line(needle) + span - 1,
    quote: lines.slice(line(needle) - 1, line(needle) - 1 + span).join('\n'),
    ...extra,
  });
  return {
    schema_version: 1 as const,
    skill: 'unnamed-skill',
    source_sha: parseSkill(text).sha,
    nodes: [
      { ...node('n-beliefs', 'gate', '判决必须落地', 3) },
      node('n-data', 'stage', '按页面类型采集', 1, { topics: ['取证', '数据'] }),
      node('n-teardown', 'stage', '单账号深拆', 1, { topics: ['拆解', '四层'] }),
      { ...node('n-verdict-gate', 'gate', '交付前必须核对判决是否落地', 1, { topics: ['交付', '判决'] }) },
      node('n-report', 'artifact', '输出《拆解报告》', 1, { topics: ['交付', '报告'] }),
    ],
    edges: [
      { from: 'n-data', to: 'n-teardown', kind: 'sequence' as const },
      // n-teardown is under ## 流程 and n-report under ## 输出: a cross-chapter
      // edge has to quote the sentence that pays for it.
      { from: 'n-teardown', to: 'n-report', kind: 'sequence' as const, reason: 'L40 输出《拆解报告》是这一步的产出' },
    ],
    associations: [],
  };
}

test('a rule section card is scoped to the Skill, not parked beside a step', () => {
  const proposal = proposalFor(SOURCE);
  const doc = buildFlowFromAnalysis(SOURCE, parseAnalysisProposal(JSON.stringify(proposal)));
  const beliefs = doc.nodes.find((node) => node.id === 'n-beliefs');
  assert.equal(beliefs?.associationScope, 'skill', '## 硬信念 constrains the Skill, so it is not bound to one card');
  assert.ok(!doc.associations.some((association) => association.from === 'n-beliefs'));
});

test('every gate that is not whole-Skill gets an owner, with evidence', () => {
  const doc = buildFlowFromAnalysis(SOURCE, parseAnalysisProposal(JSON.stringify(proposalFor(SOURCE))));
  const governed = doc.associations.filter((association) => association.from === 'n-verdict-gate');
  assert.equal(governed.length, 1, 'a gate with no declared association is still bound');
  assert.equal(governed[0].relation, 'constrains');
  assert.equal(governed[0].to, 'n-report', '交付 is the shared topic; 拆解 belongs to the teardown step, not to this rule');
  assert.match(governed[0].rationale ?? '', /共享主题/, 'the binding names the shared topic so a reader can check it');
  assert.ok(governed[0].rationale, 'the binding says why, so a reader can check it');
});

test('no gate is left unowned: bound or scoped, never floating', () => {
  const doc = buildFlowFromAnalysis(SOURCE, parseAnalysisProposal(JSON.stringify(proposalFor(SOURCE))));
  for (const gate of doc.nodes.filter((node) => node.type === 'gate')) {
    const bound = doc.associations.some((association) => association.from === gate.id);
    assert.ok(bound || gate.associationScope === 'skill', `${gate.id} is neither bound nor scoped`);
  }
});

test('an analysis may bind a gate itself, and that answer wins', () => {
  const proposal = proposalFor(SOURCE);
  proposal.associations = [{ from: 'n-verdict-gate', to: 'n-report', relation: 'constrains' as const }];
  const doc = buildFlowFromAnalysis(SOURCE, parseAnalysisProposal(JSON.stringify(proposal)));
  const governed = doc.associations.filter((association) => association.from === 'n-verdict-gate');
  assert.equal(governed.length, 1, 'the automatic pass does not add a second owner');
  assert.equal(governed[0].to, 'n-report');
});

test('a gate cannot claim a relation other than constrains', () => {
  const proposal = proposalFor(SOURCE);
  proposal.associations = [{ from: 'n-verdict-gate', to: 'n-report', relation: 'supports' as never }];
  assert.throws(() => buildFlowFromAnalysis(SOURCE, parseAnalysisProposal(JSON.stringify(proposal))), /constrains/);
});

test('a rule chapter with six rules folds behind one card, and the rest stay in the layout', () => {
  // Six rules in `## 红线` are six rules, each with its own anchor, and a lane of
  // twenty such plates was 4799px of canvas. The fold is a view: every card keeps
  // its position — `annot verify` still proves each one drawable — and the page
  // hides the tail until the reader opens the group.
  const lines = ['---', 'name: fold-demo', 'description: Six rules in one chapter.', '---', '', '# Fold', '', '## 红线', ''];
  for (let index = 1; index <= 6; index += 1) lines.push(`${index}. 红线 ${index}：必须守住。`);
  lines.push('', '## 流程', '', '做这件事。', '');
  const source = lines.join(String.fromCharCode(10));
  const sha = parseSkill(source).sha;
  const nodes = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `n-rule-${index}`,
      type: 'gate' as const,
      label: `红线 ${index + 1}`,
      start: 10 + index,
      end: 10 + index,
      quote: `${index + 1}. 红线 ${index + 1}：必须守住。`,
      associationScope: 'skill' as const,
      confidence: 0.9,
    })),
    { id: 'n-work', type: 'stage' as const, label: '做这件事', start: 19, end: 19, quote: '做这件事。', confidence: 0.9 },
    { id: 'n-next', type: 'stage' as const, label: '再做一件事', start: 19, end: 19, quote: '做这件事。', confidence: 0.9 },
    { id: 'n-third', type: 'stage' as const, label: '第三件事', start: 19, end: 19, quote: '做这件事。', confidence: 0.9 },
    { id: 'n-fourth', type: 'stage' as const, label: '第四件事', start: 19, end: 19, quote: '做这件事。', confidence: 0.9 },
  ];
  const doc = buildFlowFromAnalysis(source, parseAnalysisProposal(JSON.stringify({
    schema_version: 1,
    skill: 'fold-demo',
    source_sha: sha,
    nodes,
    edges: [
      { from: 'n-work', to: 'n-next', kind: 'sequence' },
      { from: 'n-next', to: 'n-third', kind: 'sequence' },
      { from: 'n-third', to: 'n-fourth', kind: 'sequence' },
    ],
  })));
  const layout = layoutNodes(doc);
  assert.equal(layout.nodes.length, doc.nodes.length, 'a folded card stopped being drawn');
  assert.equal(layout.folded.length, 1);
  assert.equal(layout.folded[0].heading, '红线');
  assert.equal(layout.folded[0].count, 6);
  assert.equal(layout.folded[0].ids.length, 5, 'the anchor card itself is never hidden');
  assert.equal(layout.folded[0].anchorId, 'n-rule-0');
});
test('the page counts rules as explainers, so 0 已关联 needs zero rules', () => {
  const doc = buildFlowFromAnalysis(SOURCE, parseAnalysisProposal(JSON.stringify(proposalFor(SOURCE))));
  const explainers = doc.nodes.filter((node) => node.type === 'note' || node.type === 'gate');
  assert.equal(doc.stats.noteCoverage.total, explainers.length);
  assert.equal(doc.stats.noteCoverage.associated + doc.stats.noteCoverage.global, explainers.length);
  assert.equal(doc.stats.noteCoverage.orphanTextRate, 0);
});

test('a whole-Skill rule is drawn on the context rail, never beside an unrelated step', () => {
  const doc = buildFlowFromAnalysis(SOURCE, parseAnalysisProposal(JSON.stringify(proposalFor(SOURCE))));
  const layout = layoutNodes(doc);
  const beliefs = layout.nodes.find((node) => node.id === 'n-beliefs');
  assert.equal(beliefs?.home, 'global');
  assert.equal(beliefs?.col, 'scope');
});

test('the binding is deterministic: the same document binds the same way twice', () => {
  const first = bindConstraints(buildFlowFromAnalysis(SOURCE, parseAnalysisProposal(JSON.stringify(proposalFor(SOURCE)))).nodes, []);
  const second = bindConstraints(buildFlowFromAnalysis(SOURCE, parseAnalysisProposal(JSON.stringify(proposalFor(SOURCE)))).nodes, []);
  assert.deepEqual(first, second);
});

test('a real Skill gets an owner for every gate, and its first screen is not an orphan', () => {
  const file = join(import.meta.dirname, 'fixtures', 'grill-method.md');
  const text = readFileSync(file, 'utf8');
  const doc = buildDocsFixture(text);
  const gates = doc.nodes.filter((node) => node.type === 'gate');
  assert.ok(gates.length > 0, 'the fixture has rules');
  for (const gate of gates) {
    const bound = doc.associations.some((association) => association.from === gate.id);
    assert.ok(bound || gate.associationScope === 'skill', `${gate.id} is neither bound nor scoped`);
  }
});

function buildDocsFixture(text: string) {
  const lines = text.split('\n');
  const nodes = lines
    .map((line, index) => ({ line, start: index + 1 }))
    .filter(({ line }) => /^#{2,3}\s/.test(line) || /^- /.test(line))
    .slice(0, 6)
    .map(({ line, start }, index) => ({
      id: `n-${index}`,
      type: index % 2 === 0 ? 'stage' : 'gate',
      label: line.replace(/^#+\s*/, '').slice(0, 20),
      start,
      end: start,
      quote: line,
    }));
  return buildFlowFromAnalysis(text, parseAnalysisProposal(JSON.stringify({
    schema_version: 1,
    skill: 'grill-method',
    source_sha: parseSkill(text).sha,
    nodes,
    edges: nodes.filter((node) => node.type === 'stage').slice(1).map((node, index) => ({ from: nodes.filter((n) => n.type === 'stage')[index].id, to: node.id, kind: 'sequence', reason: '按原文顺序的下一步' })),
    associations: [],
  })));
}

test('a gate that names its own targets is honoured as written', () => {
  // The model read the prose; this module did not. When it says which three
  // steps a rule governs, that is the answer — a scoring pass that overrode it
  // would be guessing where it had already been told.
  const proposal = proposalFor(SOURCE);
  proposal.nodes.find((node) => node.id === 'n-verdict-gate').references = ['n-teardown', 'n-report'];
  const doc = buildFlowFromAnalysis(SOURCE, parseAnalysisProposal(JSON.stringify(proposal)));
  const governed = doc.associations.filter((association) => association.from === 'n-verdict-gate');
  assert.deepEqual(governed.map((association) => association.to).sort(), ['n-report', 'n-teardown']);
  assert.equal(governed[0].confidence, 0.95, 'a declared owner is not a guess');
});

test('references belong to gates; a stage that names targets is rejected', () => {
  const proposal = proposalFor(SOURCE);
  proposal.nodes.find((node) => node.id === 'n-data').references = ['n-report'];
  assert.throws(() => parseAnalysisProposal(JSON.stringify(proposal)), /only a gate names the cards it governs/);
});

test("a gate with no topics has only position left, and says so", () => {
  // No topics, no citation, no quoted heading: the only evidence left is where
  // the rule was written, and the binding says so instead of pretending.
  const proposal = proposalFor(SOURCE);
  proposal.nodes.find((node) => node.id === 'n-verdict-gate').topics = undefined;
  const doc = buildFlowFromAnalysis(SOURCE, parseAnalysisProposal(JSON.stringify(proposal)));
  const governed = doc.associations.find((association) => association.from === 'n-verdict-gate');
  assert.ok(governed?.rationale?.includes('就近'), 'the fallback says it guessed by position');
});
