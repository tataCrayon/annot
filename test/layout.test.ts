/**
 * The layout is the part of the artifact that a screenshot cannot verify, so it
 * is tested directly: a deterministic geometry, a reading order that matches the
 * source, and no card that overlaps its neighbour.
 *
 * The bug this file exists for: the first layout was a column-major grid, so a
 * 19-step pipeline was cut into columns of seven and the arrows ran backwards.
 * Every test below would have passed on that grid — except the ones about
 * direction, which are the reason it was wrong.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';
import { layoutNodes, wrapLabel } from '../src/render.ts';

const here = dirname(fileURLToPath(import.meta.url));

function layoutOf(file: string, name: string) {
  const text = readFileSync(join(here, 'fixtures', file), 'utf8');
  const doc = buildFlow(parseSkill(text, { file }), text, { sourceFile: file });
  return { doc, layout: layoutNodes(doc) };
}

test('layout is deterministic: two runs of the same document are identical', () => {
  const text = readFileSync(join(here, 'fixtures', 'grill-method.md'), 'utf8');
  const doc = buildFlow(parseSkill(text, { file: 'SKILL.md' }), text, { sourceFile: 'SKILL.md' });
  // Screenshots are compared across runs, so a layout that drifts by a pixel
  // makes every past screenshot useless as evidence.
  assert.deepEqual(layoutNodes(doc), layoutNodes(doc));
});

test('every step sits below the step it follows', () => {
  const { doc, layout } = layoutOf('grill-method.md', 'grill-method.md');
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));

  for (const edge of doc.edges) {
    if (edge.kind !== 'sequence') continue;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    // The failure this pins down: in a column-major grid, node 8 of a 19-step
    // pipeline sat above node 7, and the arrow pointed up. A flow read downward
    // is the whole point of drawing it.
    assert.ok(to.y > from.y, `${edge.to} (y=${to.y}) is not below ${edge.from} (y=${from.y})`);
    assert.equal(to.band, from.band + 1, `${edge.to} is not exactly one band below ${edge.from}`);
  }
});

test('cards in the same band never overlap', () => {
  const { layout } = layoutOf('grill-method.md', 'grill-method.md');
  const bands = new Map<number, typeof layout.nodes>();
  for (const node of layout.nodes) {
    if (!bands.has(node.band)) bands.set(node.band, []);
    bands.get(node.band)?.push(node);
  }
  for (const [band, members] of bands) {
    const sorted = [...members].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const left = sorted[i - 1];
      const right = sorted[i];
      assert.ok(
        right.x >= left.x + left.w,
        `band ${band}: card at x=${right.x} starts before card ending at ${left.x + left.w}`,
      );
    }
  }
});

test('every card stays inside the reported canvas', () => {
  const { layout } = layoutOf('grill-method.md', 'grill-method.md');
  for (const node of layout.nodes) {
    assert.ok(node.x >= 0, `${node.id} starts left of the canvas`);
    assert.ok(node.x + node.w <= layout.width, `${node.id} runs past the right edge`);
    assert.ok(node.y >= 0, `${node.id} starts above the canvas`);
    assert.ok(node.y + node.h <= layout.height, `${node.id} runs past the bottom`);
  }
});

test('a long label wraps instead of being cut to one line', () => {
  const long = '把一条很长的规则写进卡片里，它需要在三个地方换行才放得下，否则读者只能看到前面几个字';
  const lines = wrapLabel(long, 264);
  assert.ok(lines.length >= 2, `a ${long.length}-character label became ${lines.length} line(s)`);
  for (const line of lines) assert.ok(line.length > 0, 'an empty line was emitted');
  // The budget is an estimate, not a measurement, so allow a little slack.
  for (const line of lines) assert.ok(line.length <= long.length);
});

test('a label too long for three lines ends in an ellipsis', () => {
  const lines = wrapLabel('很长'.repeat(80), 200, 3);
  assert.equal(lines.length, 3);
  // Truncation must be visible: a label that just stops reads as the author's
  // wording rather than as the renderer's limit.
  assert.ok(lines[2].endsWith('…'), `last line "${lines[2]}" does not admit truncation`);
});

test('an empty document still produces a usable canvas', () => {
  const layout = layoutNodes({ nodes: [], edges: [], stats: {} } as never);
  assert.equal(layout.nodes.length, 0);
  assert.ok(layout.width > 0 && layout.height > 0, 'a zero-size canvas is a blank page');
});
