import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';

const here = dirname(fileURLToPath(import.meta.url));

function fixtureFlow(file: string) {
  const text = readFileSync(join(here, 'fixtures', file), 'utf8');
  return buildFlow(parseSkill(text, { file }), text, { sourceFile: file });
}

test('first-column outcomes bind only to exact later headings', () => {
  const doc = fixtureFlow('branch-table.md');
  const fork = doc.nodes.find((node) => node.rule === 'table-of-outcomes');
  const targets = fork?.branches.map((branch) => branch.to);

  assert.deepEqual(fork?.branches.map((branch) => branch.when), ['Keep', 'Improve', 'Replace']);
  assert.equal(new Set(targets).size, 3);
  assert.equal(doc.edges.filter((edge) => edge.kind === 'branch').length, 3);
  for (const branch of fork?.branches ?? []) {
    const target = doc.nodes.find((node) => node.id === branch.to);
    assert.ok(target?.anchor.heading.includes(branch.when), `${branch.when} bound without its matching heading`);
  }
});

test('inline enumerations remain unresolved without first-column table evidence', () => {
  const doc = fixtureFlow('grill-method.md');
  const fork = doc.nodes.find((node) => node.branches.length === 3);

  assert.deepEqual(fork?.branches.map((branch) => branch.when), ['守住', '改良', '替换']);
  assert.ok(fork?.branches.every((branch) => !branch.to));
  assert.equal(doc.edges.filter((edge) => edge.kind === 'branch').length, 0);
});

test('a table with outcomes outside its first column does not create branches', () => {
  const text = [
    '# Skill',
    '',
    '## Choices',
    '',
    '| Note | Outcome |',
    '|---|---|',
    '| Continue | Keep |',
    '| Change | Replace |',
    '',
    '## Keep',
    '',
    'Continue with the current method.',
    '',
    '## Replace',
    '',
    'Choose another method.',
  ].join('\n');
  const doc = buildFlow(parseSkill(text, { file: 'other-column.md' }), text);

  assert.equal(doc.edges.filter((edge) => edge.kind === 'branch').length, 0);
  assert.ok(doc.nodes.every((node) => node.branches.length === 0));
});
