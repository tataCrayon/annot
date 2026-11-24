/**
 * The repair path is the one the user actually asked for: a skill is diagnosed
 * as blocked, and the panel used to offer only an *evaluation* task. These
 * assertions pin the two things that make a repair task trustworthy — it quotes
 * the bytes it will change, and it never claims a location it did not find.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { reviewSkill, resolveSkillFile } from '../src/standards.ts';
import { buildRepairPlan, formatRepairTask, repairSummary, unresolvedCheckIds } from '../src/repair.ts';

const grillFile = join(import.meta.dirname, 'fixtures', 'grill-method.md');

async function reportFor(source: string, file: string) {
  return reviewSkill(source, file);
}

test('a repair task quotes the exact bytes each failing check located', async () => {
  const file = grillFile;
  const source = await readFile(file, 'utf8');
  const report = await reportFor(source, file);
  const plan = buildRepairPlan(report, source);
  const target = plan.targets.find((item) => item.check.id === 'note-coverage');

  assert.ok(target, 'note-coverage is failing in the fixture and must be repairable');
  assert.ok(target.excerpt.length > 0, 'the repair target must quote the source lines');
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  for (const line of target.excerpt) assert.equal(line.text, lines[line.n - 1], `line ${line.n} does not match the source`);
  assert.equal(target.sha, report.source_sha);
});

test('a repair task never invents a location for a check that found none', async () => {
  const file = grillFile;
  const source = await readFile(file, 'utf8');
  const report = await reportFor(source, file);
  const plan = buildRepairPlan(report, source, { checkIds: ['line-budget'] });

  // line-budget is not failing in this fixture, so it contributes nothing.
  assert.equal(plan.targets.length, 0);
  assert.equal(plan.unfixable.length, 0);

  const task = formatRepairTask(plan);
  assert.match(task, /没有带修复指引的未通过项/);
});

test('the task states the boundaries a repair must not cross', async () => {
  const file = grillFile;
  const source = await readFile(file, 'utf8');
  const task = formatRepairTask(buildRepairPlan(await reportFor(source, file), source));

  assert.match(task, /没有修改任何 Skill 文件/);
  assert.match(task, /不能为了过检而删除内容/);
  assert.match(task, /不能编造目标/);
  assert.match(task, /annot review/);
  assert.match(task, /未测/);
  assert.match(task, /本次不应改动的检查项/);
});

test('sidecar checks say they are not a SKILL.md edit', async () => {
  const file = grillFile;
  const source = await readFile(file, 'utf8');
  const plan = buildRepairPlan(await reportFor(source, file), source, { checkIds: ['note-coverage'] });

  assert.equal(plan.targets[0].artifact, 'sidecar');
  assert.match(formatRepairTask(plan), /annot\.sidecar\.json（不改 SKILL\.md）/);
  assert.match(repairSummary(plan), /annot\.sidecar\.json/);
});

test('a passing check that is asked for is reported, not silently satisfied', async () => {
  const file = grillFile;
  const source = await readFile(file, 'utf8');
  const report = await reportFor(source, file);
  const plan = buildRepairPlan(report, source, { checkIds: ['name', 'note-coverage'] });

  assert.deepEqual(plan.targets.map((item) => item.check.id), ['note-coverage']);
  assert.deepEqual(unresolvedCheckIds(report, plan, ['name', 'note-coverage', 'not-a-check']), ['name']);
});

test('a blocked skill repairs its blocker first in the task body', async () => {
  const root = await mkdtemp(join(tmpdir(), 'annot-repair-'));
  try {
    const dir = join(root, 'broken-skill');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'SKILL.md');
    const source = [
      '---',
      'name: broken-skill',
      'description: Handles anything and everything. [TODO: name the trigger]',
      '---',
      '',
      '# Broken',
      '',
      'Do the thing.',
    ].join('\n');
    await writeFile(file, source, 'utf8');

    const report = await reportFor(source, file);
    assert.equal(report.readiness, 'blocked');
    const plan = buildRepairPlan(report, source);
    const task = formatRepairTask(plan);

    assert.ok(plan.targets.some((item) => item.check.id === 'unfinished-placeholder'));
    assert.match(task, /\[阻断\]/);
    assert.match(task, /\[TODO: name the trigger\]|\[TODO: …\]/);
    assert.equal(resolveSkillFile(dir), file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a repair task says the graph must be rebuilt, because every anchor just moved', async () => {
  const file = grillFile;
  const source = await readFile(file, 'utf8');
  const analysisPath = join('.annot', 'analyses', 'grill-method.analysis.json');
  const task = formatRepairTask(buildRepairPlan(await reportFor(source, file), source, { checkIds: ['note-coverage'], analysisPath }));

  // Repair edits the bytes the analysis hashed. The page then refuses the old
  // proposal; a task that stops at "check passes" leaves that refusal unowned.
  assert.match(task, /必须重做/);
  assert.match(task, /annot analyze/);
  assert.match(task, /grill-method\.analysis\.json/);
  assert.match(task, /检查项 pass」与「图能重新画出来」是两件事/);
});

test('pasted instructions are quoted verbatim and cannot widen the repair scope', async () => {
  const file = grillFile;
  const source = await readFile(file, 'utf8');
  const note = '先只修 description 的触发词\n正文结构这次不动';
  const report = await reportFor(source, file);
  const plan = buildRepairPlan(report, source, { checkIds: ['note-coverage'], note });
  const task = formatRepairTask(plan);

  assert.equal(plan.note, note);
  assert.match(task, /## 读者补充说明（原样引用）/);
  // Verbatim, multiline, inside a fence: a rewrite of the reader's words would
  // change what the host prioritises.
  assert.match(task, /```\n先只修 description 的触发词\n正文结构这次不动\n```/);
  // The note steers priority only; the boundaries stay in force.
  assert.match(task, /补充说明只改变优先级与取舍，不扩大可改动的范围/);
  // The scope is still the checks, not the note.
  assert.deepEqual(plan.targets.map((item) => item.check.id), ['note-coverage']);

  // No note, no section — an empty heading would read as a missing input.
  assert.doesNotMatch(formatRepairTask(buildRepairPlan(report, source)), /读者补充说明/);
  assert.equal(buildRepairPlan(report, source, { note: '   ' }).note, undefined);
});
