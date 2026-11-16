/**
 * Two shapes, one schema.
 *
 * A flow-shaped skill (a pipeline you walk through) and a router-shaped skill
 * (a table you dispatch on) are the two things people actually write. If the
 * extractor only handles the first, the tool quietly lies about half of every
 * skill library, so both are pinned here.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';
import type { FlowDoc } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

async function flowOf(name: string): Promise<FlowDoc> {
  const text = await readFile(join(here, 'fixtures', name), 'utf8');
  return buildFlow(parseSkill(text), text, { sourceFile: 'SKILL.md' });
}

test('router shape: the mode table is a decision, not an artifact', async () => {
  const doc = await flowOf('router-shape.md');
  const decision = doc.nodes.find((n) => n.label.includes('Mode') && n.raw.includes('|'));
  assert.ok(decision, 'the mode table did not become a node at all');
  assert.equal(decision.type, 'decision', `mode table read as ${decision.type}`);
  assert.match(decision.label, /Mode/, `label lost the header: ${decision.label}`);
});

test('router shape: every row of the table survives as source text', async () => {
  const doc = await flowOf('router-shape.md');
  const table = doc.nodes.find((n) => n.label.includes('Mode'));
  assert.ok(table);
  for (const mode of ['requirement', 'method', 'idea', 'decision']) {
    assert.match(table.raw, new RegExp(`\\*\\*${mode}\\*\\*`), `row for ${mode} was dropped`);
  }
});

test('router shape: the relay arrow chain becomes ordered stages', async () => {
  const doc = await flowOf('router-shape.md');
  const relay = doc.nodes.filter((n) => /^[1-5]\. (idea|requirement|method|decision)/.test(n.label));
  assert.equal(relay.length, 4, `expected 4 relay stages, got ${relay.map((r) => r.label).join(' | ')}`);
  assert.match(relay[0].label, /idea/);
  assert.match(relay[3].label, /decision/);
});

test('router shape: a heading-only section does not invent a node', async () => {
  const doc = await flowOf('router-shape.md');
  for (const node of doc.nodes) {
    assert.ok(node.raw.trim().length > 0, `${node.id} is empty`);
    assert.doesNotMatch(node.raw, /^#{1,6}\s/, `${node.id} is just a heading: ${node.raw}`);
  }
});

test('both shapes produce the same schema with usable anchors', async () => {
  for (const name of ['grill-method.md', 'router-shape.md', 'skill-with-frontmatter.md']) {
    const doc = await flowOf(name);
    assert.equal(doc.schema_version, 1);
    assert.ok(doc.nodes.length > 0, `${name} produced no nodes`);
    assert.ok(doc.edges.length === Math.max(0, doc.nodes.length - 1) || doc.edges.length > 0, `${name} has no edges`);
    for (const node of doc.nodes) {
      assert.ok(node.anchor.start >= 1, `${name}/${node.id} anchor start`);
      assert.ok(node.anchor.end >= node.anchor.start, `${name}/${node.id} anchor end before start`);
      assert.match(node.anchor.sha, /^[0-9a-f]{64}$/, `${name}/${node.id} anchor sha`);
      assert.ok(node.confidence > 0 && node.confidence <= 1, `${name}/${node.id} confidence`);
    }
  }
});
