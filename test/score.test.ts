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
  // The bug: `maxDepth` was `anchor.heading.length`, so the main pipeline
  // reported 2 while the canvas drew one band per flow node.
  assert.ok(doc.stats.maxDepth > 10, `maxDepth ${doc.stats.maxDepth} is still reporting heading depth`);
  // Notes preserve source context but are not flow steps. They must not make a
  // short action chain look like a 26-action pipeline in the rail count.
  assert.ok(doc.nodes.some((node) => node.type === 'note'));
  assert.ok(doc.stats.maxDepth < doc.nodes.length, 'context notes still inflate flow depth');
  assert.ok(layout.bands.length <= doc.stats.maxDepth + 1);
});

test('a skill whose steps are all prose is not scored as unreadable', () => {
  const doc = docOf('router-shape.md');
  const rail = scoreOf(doc);
  assert.ok(rail.total > 0, 'a parsable document scored zero');
  for (const reason of rail.reasons) assert.ok(reason.length > 0, 'a deduction had no explanation');
});
