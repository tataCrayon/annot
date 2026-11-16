/**
 * `annot context` is the seam where a host agent edits a skill. Its whole job is
 * to make the model's blast radius unambiguous: here is the exact text, here is
 * the line range, here is what sits on either side, and here are the rules that
 * keep the graph valid. These tests pin the properties that make that safe.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildEditContext, formatEditContext } from '../src/context.ts';
import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';
import type { FlowDoc } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

async function flow(name = 'grill-method.md'): Promise<FlowDoc> {
  const text = await readFile(join(here, 'fixtures', name), 'utf8');
  return buildFlow(parseSkill(text), text, { sourceFile: 'SKILL.md' });
}

test('the context hands back the exact bytes of the node', async () => {
  const doc = await flow();
  const node = doc.nodes[5];
  const ctx = buildEditContext(doc, node.id);
  assert.ok(ctx);
  assert.equal(ctx.original, node.raw);
  assert.equal(ctx.target.start, node.anchor.start);
  assert.equal(ctx.target.end, node.anchor.end);
  assert.equal(ctx.target.sha, node.anchor.sha);
});

test('neighbours are named so a rewrite can match the surrounding voice', async () => {
  const doc = await flow();
  const ctx = buildEditContext(doc, doc.nodes[4].id);
  assert.ok(ctx?.before, 'expected a preceding node');
  assert.ok(ctx?.after, 'expected a following node');
  assert.equal(ctx.before!.id, doc.nodes[3].id);
  assert.equal(ctx.after!.id, doc.nodes[5].id);
});

test('the first and last node do not invent a neighbour', async () => {
  const doc = await flow();
  const first = buildEditContext(doc, doc.nodes[0].id);
  const last = buildEditContext(doc, doc.nodes[doc.nodes.length - 1].id);
  assert.equal(first?.before, undefined);
  assert.equal(last?.after, undefined);
});

test('an unknown node id yields nothing instead of a wrong node', async () => {
  const doc = await flow();
  assert.equal(buildEditContext(doc, 'n-does-not-exist'), undefined);
});

test('rules always forbid the three edits that silently corrupt the graph', async () => {
  const doc = await flow();
  const ctx = buildEditContext(doc, doc.nodes[3].id)!;
  const text = ctx.rules.join('\n');
  assert.match(text, /第 \d+–\d+ 行/, 'must name the exact range');
  assert.match(text, /不要改动本范围之外/);
  assert.match(text, /不要新增或删除 markdown 标题/);
  assert.match(text, /不要在范围内插入前置空行/);
});

test('a gate node is told to keep its imperative force', async () => {
  const doc = await flow();
  const gate = doc.nodes.find((n) => n.type === 'gate');
  assert.ok(gate, 'fixture has no gate node');
  const ctx = buildEditContext(doc, gate.id)!;
  assert.match(ctx.rules.join('\n'), /门禁节点/);
});

test('a node with declared branches is told to keep them exhaustive', async () => {
  const doc = await flow();
  const branching = doc.nodes.find((n) => n.branches.length > 0);
  assert.ok(branching, 'fixture has no branching node');
  const ctx = buildEditContext(doc, branching.id)!;
  assert.match(ctx.rules.join('\n'), /已声明分支/);
});

test('the rendered context is readable and contains the source verbatim', async () => {
  const doc = await flow();
  const node = doc.nodes[6];
  const text = formatEditContext(buildEditContext(doc, node.id)!);
  assert.match(text, /# 目标：grill-method \/ /);
  assert.match(text, /## 原文（请在此基础上改）/);
  assert.ok(text.includes(node.raw), 'original text missing from the prompt');
  assert.match(text, /annot check/);
});
