import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { evaluationMethodology, formatStandardReport, reviewSkill } from '../src/standards.ts';

test('a conforming skill passes deterministic checks and references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'annot-standard-'));
  try {
    const dir = join(root, 'good-skill');
    await mkdir(join(dir, 'references'), { recursive: true });
    await writeFile(join(dir, 'references', 'rubric.md'), '# Rubric\n', 'utf8');
    const file = join(dir, 'SKILL.md');
    const source = [
      '---',
      'name: good-skill',
      'description: Review code. Use when correctness, safety, or maintainability matters.',
      '---',
      '',
      '# Review code',
      '',
      'Read the patch before making a recommendation.',
      '',
      'Load [the rubric](references/rubric.md) when scoring the result.',
    ].join('\n');

    const report = await reviewSkill(source, file);

    assert.equal(report.readiness, 'ready');
    assert.equal(report.summary.fail, 0);
    assert.equal(report.summary.warn, 0);
    assert.equal(report.groups.length, 4);
    assert.equal(report.checks.find((check) => check.id === 'references-exist')?.status, 'pass');
    assert.match(formatStandardReport(report), /不评价 Skill 的实际行为效果/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('spec violations block a skill while broad scope and broken references stay actionable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'annot-standard-bad-'));
  try {
    const dir = join(root, 'wrong-folder');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'SKILL.md');
    const source = [
      '---',
      'name: Bad Name',
      'description: Handle anything and everything for any task. [TODO: clarify triggers]',
      '---',
      '',
      '# Broken',
      '',
      'Load [the missing rubric](references/missing.md).',
    ].join('\n');

    const report = await reviewSkill(source, file);

    assert.equal(report.readiness, 'blocked');
    assert.ok(report.summary.fail >= 3);
    assert.equal(report.checks.find((check) => check.id === 'description-scope')?.status, 'warn');
    assert.equal(report.checks.find((check) => check.id === 'references-exist')?.status, 'fail');
    assert.equal(report.checks.find((check) => check.id === 'folder-name')?.status, 'warn');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('evaluation methodology separates static review from behaviour and causal evidence', () => {
  const method = evaluationMethodology();

  assert.deepEqual(method.stages.map((stage) => stage.id), ['review', 'selection', 'behavior', 'causal', 'economics']);
  assert.deepEqual(method.metrics.map((metric) => metric.id), ['selection', 'completion', 'quality', 'recovery', 'safety', 'efficiency', 'latency', 'stability']);
  assert.match(method.boundary, /不等同于效果验证/);
  assert.ok(method.tools.some((tool) => tool.name === 'skill-eval-harness'));
  assert.ok(method.tools.some((tool) => tool.name === 'Promptfoo'));
  assert.ok(method.sources.some((source) => source.url.includes('agentskills.io/specification')));
  assert.doesNotMatch(JSON.stringify(method), /effectScore|finalScore/);
});

test('note coverage exposes source targets so a warning can be inspected', async () => {
  const file = resolve('test', 'fixtures', 'grill-method.md');
  const report = await reviewSkill(await readFile(file, 'utf8'), file);
  const check = report.checks.find((item) => item.id === 'note-coverage');

  assert.ok(check);
  assert.ok(check.nodeTargets && check.nodeTargets.length > 0, 'unbound note warning has no navigable target');
  for (const target of check.nodeTargets ?? []) {
    assert.match(target.id, /^n-/);
    assert.ok(target.start > 0);
    assert.ok(target.end >= target.start);
  }
});
