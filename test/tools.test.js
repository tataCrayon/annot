/**
 * The two profile inspection tools answer questions that otherwise get answered
 * by guessing: which rows the sidebar declares and at what order, and which
 * bundles share a seat.
 *
 * They read a real profile, so the test builds a fake one: two packages, one of
 * them a copy of the shape a `sidebar.panellist` registration actually has.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');

function makeProfile() {
  const dir = mkdtempSync(join(tmpdir(), 'annot-profile-'));
  const modules = join(dir, 'node_modules');
  mkdirSync(join(modules, 'alpha'), { recursive: true });
  mkdirSync(join(modules, 'beta'), { recursive: true });

  writeFileSync(
    join(modules, 'alpha', 'client.js'),
    [
      'const offRow = ctx.slots.register({ name: "sidebar.panellist", id: "alpha", order: 1, label: () => "Alpha" }, Icon);',
      'ctx.slots.inject("sidebar.panellist", () => { markSupported(); });',
    ].join('\n'),
  );
  writeFileSync(
    join(modules, 'beta', 'client.js'),
    [
      'ctx.slots.register({ name: "sidebar.panellist", id: "beta", order: 1, label: () => "Beta" }, Icon);',
      'ctx.slots.register({ name: "main", key: "beta" }, Page);',
    ].join('\n'),
  );
  mkdirSync(join(modules, 'gamma'), { recursive: true });
  writeFileSync(join(modules, 'gamma', 'client.js'), 'ctx.slots.register({ name: "sidebar.right.pane.tab", id: "g" }, Tab);');
  return dir;
}

test('panel-orders lists every declared row and warns about a shared order', async () => {
  const profile = makeProfile();
  try {
    const { stdout } = await run(process.execPath, [join(ROOT, 'tools', 'panel-orders.ts'), profile]);
    assert.match(stdout, /order\s+1\s+alpha/);
    assert.match(stdout, /order\s+1\s+beta/);
    // Two rows at the same order sort unpredictably; that is the bug this tool
    // exists to surface, so silence here would make the tool pointless.
    assert.match(stdout, /declared more than once: 1/);
    // A package that never touches the seat must not appear as a row.
    assert.doesNotMatch(stdout, /gamma/);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test('slot-usage reports who shares a seat, and which seats nobody uses', async () => {
  const profile = makeProfile();
  try {
    const { stdout } = await run(process.execPath, [join(ROOT, 'tools', 'slot-usage.ts'), profile]);
    assert.match(stdout, /sidebar\.panellist\s+alpha, beta/);
    assert.match(stdout, /main\s+beta/);
    assert.match(stdout, /sidebar\.right\.pane\.tab\s+gamma/);
    assert.match(stdout, /2 packages share `sidebar\.panellist`/);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test('both tools fail loudly when the profile has no modules', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'annot-empty-'));
  try {
    // slot-usage simply finds nothing; panel-orders says so with exit 2 rather
    // than printing an empty table that reads like "all fine".
    const usage = await run(process.execPath, [join(ROOT, 'tools', 'slot-usage.ts'), empty]);
    assert.match(usage.stdout, /nothing registers into `sidebar\.panellist`/);

    await assert.rejects(
      run(process.execPath, [join(ROOT, 'tools', 'panel-orders.ts'), empty]),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(String(error.stdout), /no node_modules/);
        return true;
      },
    );
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
