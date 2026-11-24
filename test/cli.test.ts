/**
 * CLI argument handling, tested as a subprocess rather than by monkey-patching
 * `process.stdout`. Capturing writes in-process silences the test reporter
 * itself and makes the result depend on which file runs first; a child process
 * also lets the assertions talk about the thing that actually matters to a
 * caller — the exit code and the two streams.
 *
 * The bug these guard against lives in the parsing layer: an option declared as
 * `string` and then given no value arrives as `true`, and the failure surfaced
 * as a `TypeError` several frames deep instead of a sentence telling the user
 * what they typed wrong.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'src', 'cli.ts');

/** Invoke the real CLI; never throws on a non-zero exit. */
async function cli(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...argv], { timeout: 30_000 });
    return { code: 0, out: stdout, err: stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof failure.code === 'number' ? failure.code : 1, out: failure.stdout ?? '', err: failure.stderr ?? '' };
  }
}

test('the usage text lists every command it accepts', async () => {
  const { code, err } = await cli(['nope']);
  assert.equal(code, 1);
  for (const command of ['annotate', 'ai-prompt', 'ai-evaluate', 'check', 'list', 'search', 'audit', 'review', 'repair', 'context', 'render', 'verify', 'web', 'workbench']) {
    assert.match(err, new RegExp(command), `usage does not mention ${command}`);
  }
});

test('workbench rejects an unknown action and an invalid port', async () => {
  const action = await cli(['workbench', 'publish']);
  assert.equal(action.code, 1);
  assert.match(action.err, /open, status, or stop/);

  const port = await cli(['workbench', 'status', '--port', 'invalid']);
  assert.equal(port.code, 1);
  assert.match(port.err, /--port must be an integer/);
});

test('web rejects an invalid port before starting a listener', async () => {
  const { code, err } = await cli(['web', '--port', 'not-a-port']);
  assert.equal(code, 1);
  assert.match(err, /--port must be an integer/);
});

test('a string option given no value is a clear error, not a TypeError', async () => {
  // `--shot` with nothing after it: the parser yields `true`.
  const { code, err } = await cli(['verify', 'nothing.json', '--shot']);
  assert.equal(code, 1);
  assert.match(err, /--shot needs a directory/);
  assert.doesNotMatch(err, /TypeError|Invalid_arg|at resolve/, 'the user must not see a stack trace for a typo');
});

test('a missing artifact is reported by path, not by exception', async () => {
  const { code, err } = await cli(['verify', 'definitely-not-here.flow.json']);
  assert.equal(code, 1);
  assert.match(err, /cannot read/);
  assert.match(err, /definitely-not-here/);
});

test('search without a query exits 1 and says how to write one', async () => {
  for (const argv of [['search'], ['search', '--', 'some/root']]) {
    const { code, err } = await cli(argv);
    assert.equal(code, 1, `\`${argv.join(' ')}\` should have failed`);
    assert.match(err, /search needs a query/);
  }
});

test('search without a root exits 1 rather than scanning nothing', async () => {
  const { code, err } = await cli(['search', 'audit']);
  assert.equal(code, 1);
  assert.match(err, /search needs at least one root/);
});

test('search keeps the query intact and reports an unreadable root', async () => {
  // Flags belong before `--`: everything after it is a positional by POSIX
  // convention, which is exactly why the plugin inserts `--json` before rather
  // than appending it.
  const { code, out, err } = await cli(['search', 'audit', '--json', '--', 'no-such-root-xyz']);
  assert.equal(code, 0, `unexpected failure: ${err}`);
  const payload = JSON.parse(out);
  assert.equal(payload.query, 'audit');
  assert.deepEqual(payload.matches, []);
  assert.equal(payload.skipped.length, 1);
  assert.match(payload.skipped[0].reason, /unreadable|not a directory/);
});

test('search finds a real skill by name in metadata mode', async () => {
  const fixtures = join(here, 'fixtures');
  const { code, out } = await cli(['search', 'grill', '--json', '--', fixtures]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).query, 'grill');
});

test('--json always yields parseable output, including at zero matches', async () => {
  const { code, out } = await cli(['search', 'zzz-nothing-matches', '--json', '--', join(here, 'fixtures')]);
  assert.equal(code, 0);
  const payload = JSON.parse(out);
  assert.deepEqual(payload.matches, []);
  assert.equal(typeof payload.body, 'boolean');
});

test('context names the artifact it could not read', async () => {
  const { code, err } = await cli(['context', 'definitely-not-here.flow.json', 'n-1']);
  assert.equal(code, 1);
  assert.match(err, /cannot read|no node/);
});

test('version prints a version and exits 0', async () => {
  const { code, out } = await cli(['version']);
  assert.equal(code, 0);
  assert.match(out, /^annot \d+\.\d+\.\d+\n$/);
});

test('ai-prompt emits a line-numbered semantic analysis task', async () => {
  const file = join(here, 'fixtures', 'grill-method.md');
  const { code, out, err } = await cli(['ai-prompt', file, '--json']);
  assert.equal(code, 0, err);
  const payload = JSON.parse(out);
  assert.match(payload.prompt, /不要用关键词表、动词表或正则规则/);
  assert.match(payload.prompt, /0001 \|/);
  assert.equal(payload.source_sha.length, 64);
});

test('ai-evaluate emits behavior scenarios without certifying a result', async () => {
  const file = join(here, 'fixtures', 'grill-method.md');
  const { code, out, err } = await cli(['ai-evaluate', file, '--intent', 'check recovery', '--metrics', 'recovery', '--json']);
  assert.equal(code, 0, err);
  const payload = JSON.parse(out);
  assert.match(payload.prompt, /check recovery/);
  assert.match(payload.prompt, /without-skill/);
  assert.match(payload.prompt, /没有运行就明确写“未测”/);
});

test('review reports deterministic standards without claiming an effect score', async () => {
  const file = join(here, 'fixtures', 'grill-method.md');
  const { code, out } = await cli(['review', file, '--json']);
  assert.equal(code, 0);
  const report = JSON.parse(out);
  assert.equal(report.skill, 'grill-method');
  assert.ok(['ready', 'review', 'blocked'].includes(report.readiness));
  assert.ok(report.checks.some((check: { id: string }) => check.id === 'references-exist'));
  assert.equal(report.evaluation.stages.length, 5);
  assert.equal(report.evaluation.boundary.includes('不等同于效果验证'), true);
  assert.equal(report.source_sha.length, 64);
});

test('repair turns failing checks into a task and refuses stale check ids', async () => {
  const file = join(here, 'fixtures', 'grill-method.md');
  const all = await cli(['repair', file, '--json']);
  assert.equal(all.code, 0, all.err);
  const task = JSON.parse(all.out);
  assert.equal(task.writesSource, undefined);
  assert.equal(task.source_sha.length, 64);
  assert.ok(task.targets.length > 0);
  assert.match(task.task, /没有修改任何 Skill 文件/);
  assert.match(task.task, /annot review/);

  const single = await cli(['repair', file, '--check', 'note-coverage', '--json']);
  assert.equal(single.code, 0, single.err);
  assert.deepEqual(JSON.parse(single.out).targets.map((item: { id: string }) => item.id), ['note-coverage']);

  const unknown = await cli(['repair', file, '--check', 'not-a-check']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /unknown check id/);

  // A check that already passes means the caller's view is stale; "nothing to
  // do" would hide that, so it is an error with a sentence saying why.
  const passing = await cli(['repair', file, '--check', 'name']);
  assert.equal(passing.code, 1);
  assert.match(passing.err, /not failing, nothing to repair: name/);

  const missing = await cli(['repair']);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /repair needs a skill directory/);
});
