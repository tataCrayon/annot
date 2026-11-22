import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { associateNotes } from '../src/associations.ts';
import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';
import { layoutNodes } from '../src/render.ts';
import type { FlowNode, NodeType } from '../src/types.ts';

function node(id: string, type: NodeType, line: number, heading: string[], text: string): FlowNode {
  return {
    id,
    type,
    label: text,
    lane: type === 'artifact' ? 'output' : 'reader',
    text,
    raw: text,
    anchor: { heading, start: line, end: line, sha: 'a'.repeat(64) },
    branches: [],
    confidence: 0.7,
    flags: [],
  };
}

test('notes attach to the nearest structural node in the same section', () => {
  const nodes = [
    node('action', 'stage', 10, ['流程'], '执行主步骤'),
    node('action-note', 'note', 12, ['流程'], '说明这个步骤为什么要这样做'),
    node('gate', 'gate', 20, ['流程'], '必须检查结果'),
    node('gate-note', 'note', 22, ['流程'], '如果要通过门禁，必须保留证据'),
    node('artifact', 'artifact', 30, ['产物'], '输出检查报告'),
    node('artifact-note', 'note', 31, ['产物'], '报告示例包含四项'),
  ];

  const links = associateNotes(nodes);

  assert.equal(nodes[1].associationScope, 'node');
  assert.equal(nodes[3].associationScope, 'node');
  assert.equal(nodes[5].associationScope, 'node');
  assert.deepEqual(links.map((link) => link.relation), ['supports', 'constrains', 'explains-output']);
});

test('global and unbound notes are separated instead of being forced into a flow', () => {
  const nodes = [
    node('action', 'stage', 10, ['流程'], '执行主步骤'),
    node('principle', 'note', 2, ['核心原则'], '不确认边界就不要执行'),
    node('orphan', 'note', 80, ['附录'], '这条说明没有指向任何可证实节点'),
  ];

  const links = associateNotes(nodes);

  assert.equal(nodes[1].associationScope, 'skill');
  assert.equal(nodes[1].noteRole, 'principle');
  assert.equal(nodes[2].associationScope, 'unbound');
  assert.ok(nodes[2].flags.includes('orphan-note'));
  assert.equal(links.length, 0);
});

test('a top-level principle belongs to the Skill, not the first following action', () => {
  const nodes = [
    node('principle', 'note', 8, ['Skill'], '核心原则：没有边界就不要执行'),
    node('action', 'stage', 10, ['流程'], '执行主步骤'),
  ];

  const links = associateNotes(nodes);

  assert.equal(nodes[0].associationScope, 'skill');
  assert.equal(links.length, 0);
});

test('a shared parent heading is not treated as an explicit target reference', () => {
  const nodes = [
    node('table', 'artifact', 34, ['八项必填'], '# · 字段 · 不通过的样子'),
    node('note', 'note', 47, ['八项必填'], '自治上限只用三个词：自主、批准后执行、只建议'),
  ];

  const links = associateNotes(nodes);

  assert.equal(links[0].evidence, 'same-section');
  assert.equal(links[0].to, 'table');
});

test('a reference note prefers the section action over a later gate', () => {
  const nodes = [
    node('action', 'stage', 12, ['创建 Agent 的流程'], '判断当前步骤并执行'),
    node('gate', 'gate', 22, ['创建 Agent 的流程'], '缺失项必须标为未决'),
    node('note', 'note', 24, ['创建 Agent 的流程'], '详细判断规则读取 references/creation-flow.md'),
  ];
  nodes[0].anchor.end = 20;

  const links = associateNotes(nodes);

  assert.equal(links[0].to, 'action');
  assert.equal(links[0].relation, 'supports');
});

test('a colon lead-in binds to the block it introduces', () => {
  const nodes = [
    node('table', 'artifact', 73, ['工程标准'], '需要判断 · 读取'),
    node('note', 'note', 82, ['工程标准'], '生产代码还要用：'),
    node('command', 'external', 84, ['工程标准'], 'python scripts/validate.py'),
  ];
  nodes[0].anchor.end = 80;
  nodes[2].anchor.end = 86;

  const links = associateNotes(nodes);

  assert.equal(links[0].to, 'command');
});

test('a sidecar association can explicitly bind otherwise unbound prose', () => {
  const nodes = [
    node('action', 'stage', 10, ['流程'], '执行主步骤'),
    node('note', 'note', 50, ['附录'], '由人工确认它影响主步骤'),
  ];
  const manual = new Map([['note', { associatesWith: { toStart: 10, relation: 'supports' as const } }]]);

  const links = associateNotes(nodes, manual);

  assert.equal(nodes[1].associationScope, 'node');
  assert.equal(links.length, 1);
  assert.equal(links[0].confidence, 1);
  assert.equal(links[0].to, 'action');
});

test('a sidecar may force a note to be Skill-wide', () => {
  const nodes = [
    node('action', 'stage', 10, ['流程'], '执行主步骤'),
    node('note', 'note', 11, ['流程'], '这条看似局部，实际适用于整个 Skill'),
  ];
  const manual = new Map([['note', { associationScope: 'skill' as const }]]);

  const links = associateNotes(nodes, manual);

  assert.equal(nodes[1].associationScope, 'skill');
  assert.equal(links.length, 0);
});

test('buildFlow carries a sidecar scope override end to end', () => {
  const text = [
    '---',
    'name: scope-test',
    'description: Test scope override.',
    '---',
    '',
    '# Scope test',
    '',
    '## Flow',
    '',
    '1. Run the command.',
    '',
    'This paragraph is global.',
  ].join('\n');
  const parsed = parseSkill(text);
  const preview = buildFlow(parsed, text, { sourceFile: 'SKILL.md' });
  const note = preview.nodes.find((item) => item.type === 'note');
  assert.ok(note);

  const doc = buildFlow(parsed, text, {
    sourceFile: 'SKILL.md',
    sidecar: { skill: 'scope-test', nodes: [{ anchor: { start: note.anchor.start }, associationScope: 'skill' }] },
  });

  assert.equal(doc.nodes.find((item) => item.id === note.id)?.associationScope, 'skill');
  assert.equal(doc.stats.noteCoverage.unbound, 0);
});

test('flow stats expose note coverage without changing execution depth', () => {
  const text = readFileSync(join(import.meta.dirname, 'fixtures', 'grill-method.md'), 'utf8');
  const doc = buildFlow(parseSkill(text), text, { sourceFile: 'SKILL.md' });
  const layout = layoutNodes(doc);

  assert.ok(doc.associations.length > 0);
  assert.equal(doc.stats.noteCoverage.total, doc.nodes.filter((item) => item.type === 'note').length);
  assert.ok(doc.stats.noteCoverage.orphanTextRate >= 0 && doc.stats.noteCoverage.orphanTextRate <= 1);
  assert.equal(layout.associations.length, doc.associations.length);
  for (const association of layout.associations) assert.match(association.d, /^M /);
});
