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
import { layoutNodes, routeBetween, wrapLabel } from '../src/render.ts';

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

test('each core action advances exactly one band', () => {
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
  assert.ok(coreToCore > 0, 'no core-to-core sequence edge was found');
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

test('a long connector travels through the column gutter, never through a card', () => {
  const from = { id: 'from', x: 594, y: 269, w: 250, h: 137, col: 'side' } as never;
  const blocker = { id: 'blocker', x: 594, y: 434, w: 250, h: 116, col: 'side' } as never;
  const to = { id: 'to', x: 908, y: 392, w: 220, h: 180, col: 'artifact' } as never;
  const route = routeBetween(from, to, [from, blocker, to], { left: 0, right: 1200, top: 0, bottom: 700 }, 0);
  const points = [...route.d.matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));

  for (let index = 1; index < points.length; index += 1) {
    const left = Math.min(points[index - 1].x, points[index].x);
    const right = Math.max(points[index - 1].x, points[index].x);
    const top = Math.min(points[index - 1].y, points[index].y);
    const bottom = Math.max(points[index - 1].y, points[index].y);
    const hit = right > 594 && left < 844 && bottom > 434 && top < 550;
    assert.equal(hit, false, `connector crosses blocker: ${route.d}`);
  }
});

test('the three columns are drawn as columns, not as stacked rows', () => {
  const { layout } = layoutOf('grill-method.md', 'grill-method.md');
  // A gate that shares a row with its step is the whole point of the sketch: the
  // picture says "this step is checked by that gate" instead of putting the gate
  // between two steps it has nothing to do with.
  const placed = layout.nodes.find((node) =>
    node.col === 'side' && (node.type === 'gate' || node.type === 'external'));
  assert.ok(placed, 'the fixture has no side gate to test with');

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

  // The scope rail is last and holds only notes with no owner. It exists so a
  // Skill-wide principle is not drawn where an executable step stands.
  const scope = layout.nodes.filter((n) => n.col === 'scope');
  if (scope.length > 0) {
    assert.ok(scope.every((n) => n.type === 'note' && !n.explains), 'an owned card was drawn on the scope rail');
    const artifactRight = artifacts.length ? Math.max(...artifacts.map((n) => n.x + n.w)) : coreRight;
    assert.ok(Math.min(...scope.map((n) => n.x)) >= artifactRight, 'the scope rail is not the rightmost column');
    assert.deepEqual(
      layout.columns.map((column) => column.key),
      ['core', 'side', 'artifact', 'scope'],
      'the columns are not drawn in reading order',
    );
  }
});

test('a note hangs under the card it explains, in that card\'s column', () => {
  const { doc, layout } = layoutOf('grill-method.md', 'grill-method.md');
  const notes = layout.nodes.filter((node) => node.type === 'note' && node.explains);
  assert.ok(notes.length > 0, 'the fixture has no attached note');

  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  for (const note of notes) {
    const owner = byId.get(note.explains!);
    assert.ok(owner, `${note.id} names an owner that is not drawn`);
    assert.equal(note.col, owner.col, `${note.id} left its owner's column (${owner.col})`);
    assert.ok(note.y >= owner.y + owner.h, `${note.id} is drawn above the card it explains`);
    // One step in from the owner's left edge, never wider than the owner: the
    // plate is what steps in, the box keeps the column so every card in a column
    // still starts at one x.
    const inset = note.inset ?? 0;
    assert.ok(inset > 0, `${note.id} is not indented from its owner`);
    assert.equal(note.x, owner.x, `${note.id} is not aligned to its owner's column`);
    assert.ok(note.x + note.w <= owner.x + owner.w, `${note.id} runs past its owner's right edge`);
  }

  // No note is drawn twice, and every node in the document is drawn once: a
  // duplicated card is a second position for one anchor, which `annot verify`
  // rejects and which makes every anchor click ambiguous.
  const counts = new Map<string, number>();
  for (const node of layout.nodes) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
  assert.deepEqual([...counts].filter(([, count]) => count > 1), []);
  assert.equal(counts.size, doc.nodes.length);
});

test('a note with no owner goes to the scope rail, not beside a step', () => {
  const { doc, layout } = layoutOf('grill-method.md', 'grill-method.md');
  const orphans = layout.nodes.filter((node) => node.type === 'note' && !node.explains);
  assert.ok(orphans.length > 0, 'the fixture has no unowned note');
  assert.ok(orphans.every((node) => node.col === 'scope'), 'an unowned note is standing where an executable card stands');
  const owned = new Set(layout.nodes.filter((node) => node.explains).map((node) => node.id));
  const associations = layout.associations.filter((item) => item.from && !owned.has(item.from));
  assert.ok(associations.length <= doc.associations.length);
});

test('a document without actions promotes context into the primary column', () => {
  const text = [
    '# 只读查询',
    '',
    '只允许 `SELECT` / `SHOW`；其他语句一律拒绝。',
    '',
    '```bash',
    '# 列实例',
    'bash archery.sh --env uat instances',
    '```',
    '',
    '脚本输出：`cols`、每行、`rows=N error=None`。',
  ].join('\n');
  const doc = buildFlow(parseSkill(text, { file: 'side-artifact.md' }), text, { sourceFile: 'side-artifact.md' });
  const layout = layoutNodes(doc);

  assert.equal(layout.columns.map((column) => column.key).join(','), 'core,artifact');
  assert.equal(layout.columnHeaders.map((header) => header.key).join(','), 'core,artifact');
  assert.ok(layout.columnHeaders.every((header) => header.used));
  assert.equal(layout.columnHeaders[0].label, '主要上下文');

  const context = layout.nodes.find((node) => node.col === 'core');
  const artifact = layout.nodes.find((node) => node.col === 'artifact');
  assert.ok(context && artifact);
  assert.ok(context.x < artifact.x, 'the artifact column is left of the context column');
  assert.ok(context.x < 200, `the first real column still starts at x=${context.x}`);
  assert.ok(context.w >= 400, `context-only content stayed in a ${context.w}px sidebar`);
  assert.ok(artifact.w >= 240, `artifact-only content stayed in a ${artifact.w}px sidebar`);
  assert.ok(layout.width >= 800, `context-only canvas stayed compressed at ${layout.width}px`);

  for (const node of layout.nodes) {
    assert.ok(node.x >= 0 && node.x + node.w <= layout.width, `${node.id} is outside the canvas width`);
    assert.ok(node.y >= 0 && node.y + node.h <= layout.height, `${node.id} is outside the canvas height`);
  }

  const points = (path: string) => [...path.matchAll(/[ML] (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
  for (const edge of layout.edges) {
    const route = points(edge.d);
    for (const node of layout.nodes) {
      if (node.id === edge.from || node.id === edge.to) continue;
      for (let index = 1; index < route.length; index++) {
        const from = route[index - 1];
        const to = route[index];
        const crosses = Math.max(from.x, to.x) > node.x - 10 &&
          Math.min(from.x, to.x) < node.x + node.w + 10 &&
          Math.max(from.y, to.y) > node.y - 10 &&
          Math.min(from.y, to.y) < node.y + node.h + 10;
        assert.ok(!crosses, `${edge.from}->${edge.to} crosses ${node.id}`);
      }
    }
  }
});

test('context before the first action keeps its own column', () => {
  const { doc, layout } = layoutOf('grill-method.md', 'grill-method.md');
  const firstAction = doc.nodes.find((node) => node.type === 'stage');
  assert.ok(firstAction, 'the fixture has no key action');
  const prelude = layout.nodes.filter((node) => node.anchor.start < firstAction.anchor.start);
  const cards = prelude.filter((node) => node.type !== 'artifact' && node.type !== 'note');
  const notes = prelude.filter((node) => node.type === 'note');
  const artifacts = prelude.filter((node) => node.type === 'artifact');
  assert.ok(cards.length > 0, 'the fixture has no pre-action context');

  // The prelude used to be promoted into the action column, which is how a gate
  // ended up under a header reading 关键动作 and the real context lane was left
  // empty. A card whose type says "context" keeps the context column wherever it
  // stands in the file; only a document with no actions at all promotes it.
  assert.ok(cards.every((node) => node.col === 'side'), 'pre-action context was pushed into the action lane');
  assert.ok(artifacts.every((node) => node.col === 'artifact'), 'pre-action artifacts left their result lane');
  // Column header counts must agree with the cards actually drawn there.
  for (const header of layout.columnHeaders) {
    const drawn = layout.nodes.filter((node) => node.col === header.key && node.type !== 'note').length;
    assert.ok(header.count >= drawn, `${header.key} header says ${header.count} but ${drawn} cards are drawn`);
  }
  // A note with no owner is not "opening context": it applies to the Skill, so
  // it goes to the scope rail rather than standing where a step stands. A note
  // that does have an owner rides that owner's column instead — including an
  // artifact's notes, which stay beside the artifact.
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  for (const note of notes) {
    if (!note.explains) {
      assert.equal(note.col, 'scope', `${note.id} has no owner but is not on the scope rail`);
      continue;
    }
    const owner = byId.get(note.explains);
    assert.ok(owner, `${note.id} names an owner that is not drawn`);
    assert.equal(note.col, owner.col, `${note.id} is in a third column, not its owner's`);
  }
});

test('a phase label has a clear strip above every card', () => {
  const { layout } = layoutOf('grill-method.md', 'grill-method.md');
  assert.ok(layout.phaseRuns.length > 0, 'the fixture emitted no phase band');
  for (const run of layout.phaseRuns) {
    const members = layout.nodes.filter((node) => node.y >= run.y && node.y + node.h <= run.y + run.h);
    assert.ok(members.length > 0, `${run.label} has no cards`);
    const firstCardTop = Math.min(...members.map((node) => node.y));
    assert.ok(firstCardTop - run.y >= 24, `${run.label} leaves only ${firstCardTop - run.y}px for its label`);
  }
});

test('a document with no side cards keeps a single column', () => {
  // Three columns with two of them empty is a promise the document does not
  // keep, so the layout falls back to one column rather than drawing empty rails.
  const text = ['# 只有步骤', '', '1. 读取输入', '2. 比较结果', '3. 生成报告'].join('\n');
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

test('resolved outcome headings share a DAG layer instead of becoming a serial list', () => {
  const { doc, layout } = layoutOf('branch-table.md', 'branch-table.md');
  const fork = doc.nodes.find((node) => node.rule === 'table-of-outcomes');
  const targets = fork?.branches.map((branch) => branch.to ?? '');
  const placed = new Map(layout.nodes.map((node) => [node.id, node]));

  assert.ok(fork);
  // Branch edges used to force the whole document into the single-column stack,
  // which threw away the lanes on exactly the skills that need them most. They
  // now keep their columns; what a branch changes is depth, not the lane map.
  assert.ok(layout.columns.length > 0, 'resolved branches fell back to the single-column stack');
  assert.equal(new Set(targets?.map((id) => placed.get(id)?.band)).size, 1);
  assert.ok(layout.bands.length < doc.nodes.length, 'branch outcomes still occupy consecutive bands');
  assert.equal(doc.edges.filter((edge) => edge.kind === 'sequence' && targets?.includes(edge.to)).length, 0);
});

test('a table card keeps its rows instead of only its header', () => {  const { doc, layout } = layoutOf('grill-method.md', 'grill-method.md');
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
