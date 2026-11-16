/**
 * Tests run on Node's built-in runner against the real sample skills checked
 * into test/fixtures, because the only failure that matters here is "it read a
 * real SKILL.md wrong".
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { detectDrift } from '../src/drift.ts';
import { buildFlow } from '../src/flow.ts';
import { linesSha, parseSkill, readable } from '../src/parse.ts';
import { layoutNodes, renderHtml } from '../src/render.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, 'fixtures', name);

async function load(name: string): Promise<{ text: string; doc: ReturnType<typeof buildFlow> }> {
  const text = await readFile(fixture(name), 'utf8');
  const skill = parseSkill(text);
  return { text, doc: buildFlow(skill, text, { sourceFile: 'SKILL.md' }) };
}

test('frontmatter is read, not guessed', async () => {
  const text = await readFile(fixture('skill-with-frontmatter.md'), 'utf8');
  const skill = parseSkill(text);
  assert.equal(skill.name, 'demo-skill');
  assert.match(skill.description, /demo description/);
  assert.equal(skill.frontmatter.version, '1.0.0');
});

test('every node anchor points at the exact source lines', async () => {
  const { text, doc } = await load('grill-method.md');
  const lines = text.split('\n');
  for (const node of doc.nodes) {
    const slice = lines.slice(node.anchor.start - 1, node.anchor.end);
    assert.ok(slice.length > 0, `${node.id}: empty span`);
    assert.equal(
      linesSha(slice.map((t, i) => ({ n: node.anchor.start + i, text: t }))),
      node.anchor.sha,
      `${node.id}: anchor hash does not match the source`,
    );
    assert.equal(node.raw, slice.join('\n'), `${node.id}: raw text drifted from the anchor`);
  }
});

test('a fenced pipeline becomes one node per stage, not one opaque box', async () => {
  const { doc } = await load('grill-method.md');
  const stages = doc.nodes.filter((n) => /^(STATE|ATTACK|VERDICT|COMMIT)\b/.test(n.label));
  assert.equal(stages.length, 4, `expected 4 pipeline stages, got ${stages.map((s) => s.label).join(' | ')}`);
  for (const stage of stages) {
    assert.equal(stage.anchor.start, stage.anchor.end, `${stage.id} should own exactly one line`);
  }
});

test('inline slash enumerations become branches', async () => {
  const { doc } = await load('grill-method.md');
  const verdict = doc.nodes.find((n) => n.label.startsWith('VERDICT'));
  assert.ok(verdict, 'VERDICT node missing');
  const arms = verdict.branches.map((b) => b.when);
  assert.deepEqual(arms, ['守住', '改良', '替换']);
});

test('markdown scaffolding never becomes a node', async () => {
  const { doc } = await load('grill-method.md');
  for (const node of doc.nodes) {
    assert.ok(node.label.trim().length > 0, `${node.id} has an empty label`);
    assert.doesNotMatch(node.label, /^[|\-:\s]+$/, `${node.id} is table scaffolding: ${node.label}`);
    const content = node.raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/^(```|~~~)/.test(line));
    assert.ok(content.length > 0, `${node.id} carries no content beyond a fence: ${JSON.stringify(node.raw)}`);
  }
});

test('ids are ASCII and unique', async () => {
  const { doc } = await load('grill-method.md');
  const ids = new Set<string>();
  for (const node of doc.nodes) {
    assert.match(node.id, /^n-[a-z0-9-]+$/, `${node.id} is not a usable anchor id`);
    assert.ok(!ids.has(node.id), `duplicate id ${node.id}`);
    ids.add(node.id);
  }
});

test('drift: a node that moved is relocated, not silently re-guessed', async () => {
  const { text, doc } = await load('grill-method.md');
  const target = doc.nodes[4];
  const edited = `<!-- inserted by a human -->\n\n${text}`;
  const result = detectDrift(doc, edited);
  assert.equal(result.ok, false, 'inserting lines must be reported as drift');
  const moved = result.stale.find((s) => s.id === target.id);
  assert.ok(moved, `${target.id} should be reported`);
  assert.equal(moved.reason, 'moved');
  assert.equal(moved.to, target.anchor.start + 2);
});

test('drift: deleting a node breaks its anchor instead of pointing at a neighbour', async () => {
  const { text, doc } = await load('grill-method.md');
  const victim = doc.nodes[3];
  const lines = text.split('\n');
  lines.splice(victim.anchor.start - 1, victim.anchor.end - victim.anchor.start + 1, '（已删除）');
  const result = detectDrift(doc, lines.join('\n'));
  const broken = result.stale.find((s) => s.id === victim.id);
  assert.ok(broken, `${victim.id} should be reported`);
  assert.equal(broken.reason, 'broken');
});

test('drift: an untouched skill reports clean', async () => {
  const { text, doc } = await load('grill-method.md');
  const result = detectDrift(doc, text);
  assert.equal(result.ok, true, JSON.stringify(result.stale));
});

test('rendered HTML is self-contained and its script compiles', async () => {
  const { doc } = await load('grill-method.md');
  const html = renderHtml(doc);

  assert.doesNotMatch(html, /src="https?:/, 'must not load remote scripts');
  assert.doesNotMatch(html, /href="https?:[^"]*\.css"/, 'must not load remote styles');
  assert.doesNotMatch(html, /<script[^>]+src=/, 'must not reference an external script file');
  assert.match(html, /<script id="flow-data" type="application\/json">/);

  const match = /<script>\n([\s\S]*?)\n<\/script>/.exec(html);
  assert.ok(match, 'client script not found');
  // Compile only: running it needs a DOM, and a syntax error is the failure
  // mode that silently produces a blank page.
  new vm.Script(match[1], { filename: 'annot-client.js' });

  const payload = /<script id="flow-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(payload);
  const parsed = JSON.parse(payload[1].replace(/\\u003c/g, '<'));
  assert.equal(parsed.nodes.length, doc.nodes.length);
});

test('layout is deterministic and does not overlap', async () => {
  const { doc } = await load('grill-method.md');
  const a = layoutNodes(doc);
  const b = layoutNodes(doc);
  assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.y]), b.nodes.map((n) => [n.id, n.x, n.y]));

  for (let i = 0; i < a.nodes.length; i++) {
    for (let j = i + 1; j < a.nodes.length; j++) {
      const p = a.nodes[i];
      const q = a.nodes[j];
      const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
      assert.ok(!overlap, `${p.id} overlaps ${q.id}`);
    }
  }
});

test('sidecar can retype, rename and drop nodes', async () => {
  const text = await readFile(fixture('grill-method.md'), 'utf8');
  const skill = parseSkill(text);
  const base = buildFlow(skill, text, { sourceFile: 'SKILL.md' });
  const victim = base.nodes[2];

  const patched = buildFlow(skill, text, {
    sourceFile: 'SKILL.md',
    sidecar: {
      skill: 'grill-method',
      nodes: [
        { anchor: { start: victim.anchor.start }, type: 'gate', rename: '人工确认' },
        { anchor: { start: base.nodes[5].anchor.start }, ignore: true },
      ],
    },
  });

  const renamed = patched.nodes.find((n) => n.id.startsWith('n-'));
  assert.ok(renamed);
  const target = patched.nodes.find((n) => n.anchor.start === victim.anchor.start);
  assert.ok(target, 'retyped node disappeared');
  assert.equal(target.type, 'gate');
  assert.equal(target.label, '人工确认');
  assert.equal(target.source, 'sidecar');
  assert.equal(patched.nodes.length, base.nodes.length - 1, 'ignore should drop exactly one node');
});

test('readable() strips markdown noise without eating content', () => {
  assert.equal(readable('- **粗体** `code`'), '粗体 code');
  assert.equal(readable('| a | b |').replace(/\s+/g, ' ').trim(), 'a | b');
  assert.equal(readable('> 引用').trim(), '引用');
});
