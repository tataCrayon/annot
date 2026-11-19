/**
 * The two numbers a user sees about the same picture must not disagree.
 *
 * There used to be two independent score functions: `audit` said higher is
 * worse (0 = nothing visibly broken), the artifact's rail said higher is better
 * (100 = readable), and nothing tied them together. This file pins the single
 * defect vector both of them read.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditFlow, defectsOf } from '../src/audit.ts';
import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';
import { layoutNodes, scoreOf } from '../src/render.ts';

const here = dirname(fileURLToPath(import.meta.url));

function docOf(file: string) {
  const text = readFileSync(join(here, 'fixtures', file), 'utf8');
  return buildFlow(parseSkill(text, { file }), text, { sourceFile: file });
}

test('audit and the rail read the same defects', () => {
  const doc = docOf('grill-method.md');
  const audit = auditFlow(doc, doc.source.lines);
  const defects = defectsOf(doc, doc.source.lines);
  assert.deepEqual(
    { low: audit.lowConfidence, unres: audit.unresolvedBranches, empty: audit.emptyText, junk: audit.junkLabels, density: audit.density },
    { low: defects.lowConfidence, unres: defects.unresolvedBranches, empty: defects.emptyText, junk: defects.junkLabels, density: defects.density },
  );
  assert.equal(audit.score, defects.score);
});

test('the rail score is exactly the audit score, inverted', () => {
  for (const file of ['grill-method.md', 'router-shape.md']) {
    const doc = docOf(file);
    const audit = auditFlow(doc, doc.source.lines);
    const rail = scoreOf(doc);
    // Not merely correlated: one number, two directions. A user who reads 70 on
    // the rail and 30 in `audit` is looking at the same picture twice.
    assert.equal(rail.total, Math.max(0, 100 - Math.round(audit.score)), file);
  }
});

test('maxDepth counts sequence steps, not heading nesting', () => {
  const doc = docOf('grill-method.md');
  const layout = layoutNodes(doc);
  // The bug: `maxDepth` was `anchor.heading.length`, so this 26-step pipeline
  // reported 2 while the canvas drew 26 bands.
  assert.ok(doc.stats.maxDepth > 10, `maxDepth ${doc.stats.maxDepth} is still reporting heading depth`);
  // It counts steps, not rows: since the column layout puts a gate on the same
  // row as its step, the canvas has fewer rows than the document has steps, and
  // both numbers are right about different things.
  assert.equal(doc.stats.maxDepth, doc.nodes.length);
  assert.ok(layout.bands.length < doc.nodes.length, 'every node still got its own row');
});

test('a skill whose steps are all prose is not scored as unreadable', () => {
  const doc = docOf('router-shape.md');
  const rail = scoreOf(doc);
  assert.ok(rail.total > 0, 'a parsable document scored zero');
  for (const reason of rail.reasons) assert.ok(reason.length > 0, 'a deduction had no explanation');
});
