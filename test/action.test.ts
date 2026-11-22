import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildFlow } from '../src/flow.ts';
import { linesSha, parseSkill } from '../src/parse.ts';

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(here, 'fixtures', 'action-semantics.md'), 'utf8');
const doc = buildFlow(parseSkill(text), text, {
  sourceFile: 'action-semantics.md',
  now: () => '2026-01-01T00:00:00.000Z',
});

const grillText = readFileSync(join(here, 'fixtures', 'grill-method.md'), 'utf8');
const grillDoc = buildFlow(parseSkill(grillText), grillText, {
  sourceFile: 'grill-method.md',
  now: () => '2026-01-01T00:00:00.000Z',
});

function nodeContaining(fragment: string) {
  const node = doc.nodes.find((candidate) => candidate.raw.includes(fragment));
  assert.ok(node, `no node contains ${fragment}`);
  return node;
}

test('a script result is an artifact, never a fallback stage', () => {
  const node = nodeContaining('脚本输出');
  assert.equal(node.type, 'artifact');
  assert.match(node.label, /^输出/);
  assert.doesNotMatch(node.label, /^脚本输出/);
});

test('a read-only rule is a gate whose title states the permitted action', () => {
  const node = nodeContaining('只允许 `SELECT`');
  assert.equal(node.type, 'gate');
  assert.match(node.label, /只允许|一律拒绝/);
  assert.doesNotMatch(node.label, /^只读/);
});

test('a CSRF incompatibility is classified as a gate', () => {
  const node = nodeContaining('代替不了 cookie');
  assert.equal(node.type, 'gate');
  assert.match(node.label, /代替不了 cookie/);
});

test('a diagnostic warning keeps its corrective action visible', () => {
  const wrongEnv = nodeContaining('选错站点');
  assert.equal(wrongEnv.type, 'gate');

  const warning = nodeContaining('先确认');
  assert.equal(warning.type, 'gate');
  assert.match(warning.label, /先确认 --env/);
});

test('a code block is titled by the actions it exposes, not its setup variable', () => {
  const node = nodeContaining('列实例');
  assert.equal(node.type, 'external');
  assert.match(node.label, /列实例/);
  assert.doesNotMatch(node.label, /^S=/);
});

test('repeated extraction does not alternate a code block between types', () => {
  const types = Array.from({ length: 6 }, () => {
    const repeated = buildFlow(parseSkill(text), text, { sourceFile: 'action-semantics.md' });
    return repeated.nodes.find((candidate) => candidate.raw.includes('列实例'))?.type;
  });
  assert.deepEqual(new Set(types), new Set(['external']));
});

test('a real action list remains a stage and starts with the action', () => {
  const node = nodeContaining('读取输入文件');
  assert.equal(node.type, 'stage');
  assert.match(node.label, /^读取输入文件/);
});

test('a question-template table is a reference artifact, not an external call', () => {
  const node = grillDoc.nodes.find((candidate) => candidate.label === '方向 · 问题模板');
  assert.ok(node, 'no direction/question-template table');
  assert.equal(node.type, 'artifact');
  assert.equal(node.rule, 'reference-table');
});

test('normative quality and size limits are gates, not context notes', () => {
  const answerable = grillDoc.nodes.find((candidate) => candidate.raw.includes('一个好问题必须'));
  const cardLimit = grillDoc.nodes.find((candidate) => candidate.raw.includes('判决卡控制在'));
  assert.ok(answerable, 'no answerable-question constraint');
  assert.ok(cardLimit, 'no verdict-card size constraint');
  assert.equal(answerable.type, 'gate');
  assert.equal(answerable.rule, 'explicit-constraint');
  assert.equal(cardLimit.type, 'gate');
  assert.equal(cardLimit.rule, 'explicit-constraint');
});

test('declared pipeline stages describe the action without a workflow marker', () => {
  const stages = grillDoc.nodes.filter((node) => /^(STATE|ATTACK|VERDICT|COMMIT)\b/.test(node.raw));
  assert.equal(stages.length, 4, 'the declared four-step pipeline should remain four nodes');
  assert.deepEqual(stages.map((node) => node.type), ['stage', 'stage', 'stage', 'stage']);
  for (const stage of stages) {
    assert.doesNotMatch(stage.label, /^(STATE|ATTACK|VERDICT|COMMIT)\b/);
  }
  assert.match(stages[0].label, /说清/);
  assert.match(stages[1].label, /发问/);
  assert.match(stages[2].label, /判决/);
  assert.match(stages[3].label, /写下/);

  const source = grillText.split('\n');
  for (const stage of stages) {
    const anchored = source.slice(stage.anchor.start - 1, stage.anchor.end);
    assert.equal(stage.raw, anchored.join('\n'));
    assert.equal(
      stage.anchor.sha,
      linesSha(anchored.map((line, index) => ({ n: stage.anchor.start + index, text: line }))),
    );
  }
});

test('semantic relabelling leaves the exact source anchor untouched', () => {
  const lines = text.split('\n');
  for (const node of doc.nodes) {
    const source = lines.slice(node.anchor.start - 1, node.anchor.end);
    assert.equal(node.raw, source.join('\n'), `${node.id} raw text drifted`);
    assert.equal(
      node.anchor.sha,
      linesSha(source.map((line, index) => ({ n: node.anchor.start + index, text: line }))),
      `${node.id} anchor hash drifted`,
    );
  }
});
