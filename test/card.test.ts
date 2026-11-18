/**
 * The card is what the reader actually sees, so what it says is a contract.
 *
 * Four real skills produced cards titled `bash`, `json` and `markdown` — the
 * fence tag, not the step — and a 34-card graph where 47% of the titles ended in
 * an ellipsis and 79% of the source text never reached the screen. These tests
 * pin the three properties that fixed it: a code card is titled by its content,
 * every card carries the lane that performed it, and a declared phase survives.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');

function flowOf(text: string, name = 'fixture.md') {
  const skill = parseSkill(text, { file: name });
  return buildFlow(skill, text, { sourceFile: name, now: () => '2026-01-01T00:00:00.000Z' });
}

const CODE_TAGS = ['bash', 'json', 'markdown', 'sh', 'python', 'yaml', 'javascript', 'typescript', 'text'];

test('a fenced block is titled by its command, never by its fence tag', () => {
  const doc = flowOf(
    [
      '# Skill',
      '',
      '## Run',
      '',
      '```bash',
      'node ~/.claude/mcp-gateway/gateway.js --status',
      '```',
      '',
      '```json',
      '{"mcpServers": {"gateway": {"url": "http://127.0.0.1:8808/mcp"}}}',
      '```',
      '',
    ].join('\n'),
  );

  for (const node of doc.nodes) {
    assert.ok(
      !CODE_TAGS.includes(node.label.trim().toLowerCase()),
      `a card is titled "${node.label}", which is a code fence tag, not a step`,
    );
  }
  assert.ok(doc.nodes.length >= 2, `expected both blocks to become cards, got ${doc.nodes.length}`);
});

test('a JSON block is titled by its first key, not by the brace', () => {
  const doc = flowOf(['# S', '', '## C', '', '```json', '{', '  "a": 1', '}', '```', ''].join('\n'));
  const label = doc.nodes[0].label;
  assert.ok(/[\p{L}\p{N}]/u.test(label), `"${label}" carries no word at all`);
});

test('every card names who performs it', () => {
  const doc = flowOf(
    [
      '# Skill',
      '',
      '## Steps',
      '',
      'Run the fetch yourself.',
      '',
      '```bash',
      'git fetch origin main --quiet',
      '```',
      '',
      'Then write the report.',
      '',
    ].join('\n'),
  );

  const allowed = ['reader', 'tool', 'model', 'output'];
  for (const node of doc.nodes) {
    assert.ok(allowed.includes(node.lane), `${node.id} has lane "${node.lane}"`);
  }
  const tool = doc.nodes.find((n) => n.raw.includes('git fetch'));
  assert.equal(tool?.lane, 'tool', 'a shell command is work the tool performs, not the reader');
  assert.equal(doc.stats.byLane.tool, 1);
});

test('a heading that names a phase becomes a phase column', () => {
  const doc = flowOf(
    [
      '# Skill',
      '',
      '## Phase 1：对比',
      '',
      '第一步。',
      '',
      '第二步。',
      '',
      '## Phase 2：生成',
      '',
      '第三步。',
      '',
    ].join('\n'),
  );

  assert.equal(doc.phases.length, 2, `expected 2 phases, got ${JSON.stringify(doc.phases)}`);
  assert.match(doc.phases[0].label, /Phase 1/);
  assert.equal(doc.phases[0].nodes + doc.phases[1].nodes, doc.nodes.length);
  for (const node of doc.nodes) assert.equal(typeof node.phase, 'string');
});

test('a skill with no phase heading declares no phases, and does not invent one', () => {
  const doc = flowOf(['# Skill', '', '## 什么算好', '', '一段话。', '', '## 触发', '', '另一段。', ''].join('\n'));
  assert.deepEqual(doc.phases, []);
  for (const node of doc.nodes) assert.equal(node.phase, undefined);
});

test('an intro line ending in a colon carries the detail under it', () => {
  const doc = flowOf(
    [
      '# Skill',
      '',
      '## Steps',
      '',
      '**步骤 1 — 确认网关**：',
      '有输出且 backends 里有 cmdb 即为正常',
      '',
    ].join('\n'),
  );

  const node = doc.nodes[0];
  assert.equal(node.subtitle, '有输出且 backends 里有 cmdb 即为正常');
  assert.notEqual(node.subtitle, node.label);
});

test('a bullet list does not promote its second bullet to a subtitle', () => {
  // The bullets are parallel steps. Taking the second one as "detail of the
  // first" would report a relationship the author never wrote.
  const doc = flowOf(
    ['# S', '', '## C', '', '- 第一步：取数', '- 第二步：比对', '- 第三步：出报告', ''].join('\n'),
  );
  const node = doc.nodes[0];
  assert.equal(node.subtitle, undefined, `a list invented the subtitle "${node.subtitle}"`);
});

test('a shell line keeps its expectation as the subtitle', () => {
  const doc = flowOf(
    ['# S', '', '## C', '', '```bash', 'node gateway.js --status  # 有输出即为正常', '```', ''].join('\n'),
  );
  assert.equal(doc.nodes[0].subtitle, '有输出即为正常');
});

test('every card records the rule that produced it, so the score can be explained', () => {
  const doc = flowOf(['# S', '', '## C', '', '一段普通的文字。', ''].join('\n'));
  assert.equal(doc.nodes[0].rule, 'paragraph');
  assert.equal(doc.nodes[0].confidence, 0.65);
  // The point: the score is a constant of the rule, not a probability.
  const other = flowOf(['# S', '', '## C', '', '另一段普通的文字。', ''].join('\n'));
  assert.equal(other.nodes[0].confidence, doc.nodes[0].confidence);
});

test('the lane and phase of a real skill survive the round trip', () => {
  const text = readFileSync(join(ROOT, 'test', 'fixtures', 'grill-method.md'), 'utf8');
  const doc = flowOf(text, 'grill-method.md');
  for (const node of doc.nodes) {
    assert.ok(['reader', 'tool', 'model', 'output'].includes(node.lane), `${node.id} lane`);
  }
  const total = doc.stats.byLane.reader + doc.stats.byLane.tool + doc.stats.byLane.model + doc.stats.byLane.output;
  assert.equal(total, doc.nodes.length, 'every node is counted in exactly one lane');
});
