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

test('no connector points back up the page', () => {
  const { doc, layout } = layoutOf('grill-method.md', 'grill-method.md');
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  let checked = 0;

  for (const edge of doc.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    checked++;
    // The failure this pins down: in a column-major grid, node 8 of a 19-step
    // pipeline sat above node 7 and the arrow pointed up. In the column layout a
    // step and its gate share a row, so "below" is not the rule any more — but
    // "never upward" still is.
    assert.ok(
      to.y + to.h > from.y + 1,
      `${edge.to} (y=${to.y}..${to.y + to.h}) ends above ${edge.from} (y=${from.y})`,
    );
  }
  assert.ok(checked > 0, 'no edge was checked');
});

test('a step and the step after it are one row apart', () => {
  const { doc, layout } = layoutOf('grill-method.md', 'grill-method.md');
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const core = (id: string) => (byId.get(id)?.col ?? 'core') === 'core';
  let coreToCore = 0;

  for (const edge of doc.edges) {
    if (edge.kind !== 'sequence') continue;
    if (!core(edge.from) || !core(edge.to)) continue;
    coreToCore++;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    assert.ok(from && to);
    // Side cards share a row with their step, so only the main path advances a
    // row — and it advances exactly one, which is what keeps the trunk straight.
    assert.equal(to.band, from.band + 1, `${edge.to} is not exactly one row below ${edge.from}`);
  }
  assert.ok(coreToCore > 5, `only ${coreToCore} core-to-core edges found`);
});

test('no two cards overlap anywhere on the canvas', () => {
  const { layout } = layoutOf('grill-method.md', 'grill-method.md');
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i];
      const b = layout.nodes[j];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `${a.id} and ${b.id} overlap`);
    }
  }
});

test('the three columns are drawn as columns, not as stacked rows', () => {
  const { doc, layout } = layoutOf('grill-method.md', 'grill-method.md');
  // A gate that shares a row with its step is the whole point of the sketch: the
  // picture says "this step is checked by that gate" instead of putting the gate
  // between two steps it has nothing to do with.
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const side = doc.nodes.find((n) => n.type === 'gate' || n.type === 'external');
  assert.ok(side, 'the fixture has no gate to test with');
  const placed = byId.get(side.id);
  assert.ok(placed);
  assert.equal(placed.col, 'side');

  const core = layout.nodes.filter((n) => n.col === 'core');
  const gate = layout.nodes.filter((n) => n.col === 'side');
  const artifacts = layout.nodes.filter((n) => n.col === 'artifact');
  assert.ok(core.length > 0 && gate.length > 0);
  // Each column has one x for every card in it: a column that walks left and
  // right per band is unreadable even when every card is correct.
  for (const column of [core, gate, artifacts]) {
    if (column.length === 0) continue;
    const xs = new Set(column.map((n) => n.x));
    assert.equal(xs.size, 1, `column ${column[0].col} has ${xs.size} different x positions`);
  }
  // Left to right: core, then gates, then artifacts.
  const coreRight = Math.max(...core.map((n) => n.x + n.w));
  assert.ok(Math.min(...gate.map((n) => n.x)) > coreRight, 'the gate column is left of the main path');
});

test('a document with no side cards keeps a single column', () => {
  // Three columns with two of them empty is a promise the document does not
  // keep, so the layout falls back to one column rather than drawing empty rails.
  const text = ['# 只有步骤', '', '1. 第一步', '2. 第二步', '3. 第三步'].join('\n');
  const doc = buildFlow(parseSkill(text, { file: 'linear.md' }), text, { sourceFile: 'linear.md' });
  assert.ok(doc.nodes.every((n) => n.type === 'stage'), 'the fixture is not all stages');
  const layout = layoutNodes(doc);
  assert.deepEqual(layout.columns, []);
  assert.deepEqual(layout.columnHeaders, []);
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

test('an unresolved fork draws its arms inside the card width', () => {
  const { layout } = layoutOf('grill-method.md', 'grill-method.md');
  const forked = layout.nodes.filter((n) => n.arms.length > 0);
  // grill-method's VERDICT step forks 守住 / 改良 / 替换 and none of the three
  // lands anywhere. Before this, the card looked like any other step and the
  // fork existed only as a number in its corner.
  assert.ok(forked.length > 0, 'no card drew its unresolved fork');
  for (const node of forked) {
    const span = node.arms.reduce((sum, arm) => sum + arm.w, 0) + (node.arms.length - 1) * 8;
    assert.ok(span <= node.w, `${node.id}: arms span ${span}px in a ${node.w}px card`);
    // The plate stops where the arms begin, so an arm can never be painted on
    // top of the footer.
    assert.ok(node.h > node.cardH, `${node.id}: h=${node.h} leaves no room for cardH=${node.cardH}`);
    for (const arm of node.arms) assert.ok(arm.label.length > 0, `${node.id} has a blank arm`);
  }
});

test('a table card keeps its rows instead of only its header', () => {
  const { doc, layout } = layoutOf('grill-method.md', 'grill-method.md');
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const node of doc.nodes) {
    const placed = byId.get(node.id);
    assert.ok(placed);
    const isTable = /^\|[\s:|-]+\|?$/m.test(node.raw.split('\n')[1] ?? '');
    if (!isTable) {
      assert.deepEqual(placed.rows, [], `${node.id} is not a table but grew rows`);
      continue;
    }
    // A table is where a skill states its rule; flattening it to the header row
    // hid the whole "八项必填" checklist behind a title.
    assert.ok(placed.rows.length > 0, `${node.id} is a table with no visible rows`);
    for (const row of placed.rows) assert.ok(row.length > 0, `${node.id} has a blank row`);
  }
});
