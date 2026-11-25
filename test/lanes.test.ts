/**
 * The swimlane contract.
 *
 * `lane` has been in `flow.json` since the first release and the schema said it
 * "drives the swimlane the card is drawn in". It did not: every card was drawn in
 * one column and the lane reached only a corner label, so `git fetch` and "decide
 * whether the branch is behind" looked like the same kind of work. These tests
 * pin the three properties that make a lane real: the card stands in its lane's
 * column, the lane is named on the canvas, and a card's type never overrides what
 * the analysis said about who performs it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildFlowFromAnalysis } from '../src/analysis.ts';
import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';
import { layoutNodes } from '../src/render.ts';

const here = dirname(fileURLToPath(import.meta.url));

function layoutOf(text: string, name = 'lanes.md') {
  const doc = buildFlow(parseSkill(text, { file: name }), text, { sourceFile: name });
  return { doc, layout: layoutNodes(doc) };
}

const MIXED = [
  '---',
  'name: lanes',
  'description: "A skill that mixes commands with judgement."',
  '---',
  '',
  '# Lanes',
  '',
  '## Commands',
  '',
  '```bash',
  'git fetch --all',
  '```',
  '',
  '## Judge',
  '',
  '比较本地与远程，判断是否可以合并。',
  '',
].join('\n');

test('a command stands in the action column, in the tool lane', () => {
  const { layout } = layoutOf(MIXED);
  const tool = layout.nodes.find((node) => node.lane === 'tool');
  assert.ok(tool, 'the fenced command did not become a tool-lane card');
  assert.equal(tool.col, 'core');

  const runs = layout.laneRuns;
  assert.ok(runs.length >= 2, `a mixed document drew ${runs.length} lane bands`);
  const toolBand = runs.find((run) => run.lane === 'tool');
  const readerBand = runs.find((run) => run.lane === 'reader');
  assert.ok(toolBand && readerBand, 'the canvas names only part of its lanes');
  assert.ok(toolBand.count >= 1 && readerBand.count >= 1);
  assert.ok(toolBand.h > 0 && readerBand.h > 0);
});

test('a single-lane document draws no lane band', () => {
  // One lane filling the whole column is a border around everything: it says
  // nothing and costs a dashed rectangle on every card.
  const text = [
    '---',
    'name: steps',
    'description: "three steps"',
    '---',
    '',
    '# Steps',
    '',
    '读取输入文件。',
    '',
    '比较两次结果。',
    '',
    '生成报告。',
  ].join('\n');
  const { layout } = layoutOf(text, 'steps.md');
  assert.deepEqual(layout.laneRuns, []);
});

test('lane bands never overlap the cards they do not contain', () => {
  const { layout } = layoutOf(MIXED);
  for (const run of layout.laneRuns) {
    for (const node of layout.nodes) {
      if (node.lane === run.lane) continue;
      if (node.type === 'note') continue;
      const apart = node.y + node.h <= run.y || run.y + run.h <= node.y || node.x + node.w <= run.x || run.x + run.w <= node.x;
      assert.ok(apart, `${node.id} (${node.lane}) stands inside the ${run.lane} band`);
    }
  }
});

test('an analysis lane survives into the drawn layout', () => {
  // The AI path is the only path the workbench uses, so the lane it assigns has
  // to reach the canvas unchanged: a type-derived lane here would silently
  // override the model's judgement about who performs the step.
  const source = readFileSync(join(here, 'fixtures', 'branch-table.md'), 'utf8');
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const at = (needle: string) => {
    const index = lines.findIndex((line) => line.includes(needle));
    return { start: index + 1, end: index + 1, quote: lines[index] };
  };
  const proposal = {
    schema_version: 1 as const,
    skill: 'branch-table',
    source_sha: parseSkill(source).sha,
    nodes: [
      { id: 'n-run', type: 'stage' as const, label: 'Run the check', lane: 'tool' as const, ...at('Review the proposed method') },
      { id: 'n-judge', type: 'stage' as const, label: 'Judge the result', lane: 'reader' as const, ...at('Continue with the current method.') },
    ],
    // Two cards under different chapters: the contract asks which sentence links
    // them, so this fixture says so rather than leaving a jump unpaid.
    edges: [{ from: 'n-run', to: 'n-judge', kind: 'sequence' as const, reason: 'Continue with the result' }],
  };
  const doc = buildFlowFromAnalysis(source, proposal, { sourceFile: 'branch-table.md' });
  assert.deepEqual(doc.nodes.map((node) => node.lane), ['tool', 'reader'], 'the proposal lanes were rewritten');
  const layout = layoutNodes(doc);
  const run = layout.nodes.find((node) => node.id === 'n-run');
  assert.ok(run);
  assert.equal(run.col, 'core');
  assert.deepEqual(layout.laneRuns.map((band) => band.lane), ['tool', 'reader']);
});
