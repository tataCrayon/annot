import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { openWorkbench, stopWorkbench, workbenchStatus } from '../src/workbench.ts';
import { startWebServer } from '../src/web.ts';

test('workbench open is idempotent and stop only terminates the managed server', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'annot-workbench-'));
  const port = await freePort();
  const options = {
    cwd: workspace,
    port,
    entryPoint: resolve('bin', 'annot.ts'),
    openBrowser: false,
    timeoutMs: 15_000,
  };

  try {
    const started = await openWorkbench(options);
    assert.equal(started.running, true);
    assert.equal(started.started, true);
    assert.equal(started.managed, true);
    assert.equal(started.url, `http://127.0.0.1:${port}`);

    const reused = await openWorkbench(options);
    assert.equal(reused.started, false);
    assert.equal(reused.managed, true);

    const status = await workbenchStatus(options);
    assert.equal(status.running, true);
    assert.equal(status.pid, started.pid);

    const stopped = await stopWorkbench(options);
    assert.equal(stopped.running, false);
  } finally {
    try { await stopWorkbench(options); } catch {}
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a managed workbench that loaded other code is restarted, not reused', async () => {
  // The bug this pins: `workbench open` reused whatever answered on the port, so
  // after a code change the browser ran the new page against the old layout and
  // the only visible symptom was "the fix did not work".
  const workspace = await mkdtemp(join(tmpdir(), 'annot-workbench-stale-'));
  const port = await freePort();
  const options = {
    cwd: workspace,
    port,
    entryPoint: resolve('bin', 'annot.ts'),
    openBrowser: false,
    timeoutMs: 15_000,
  };

  try {
    const first = await openWorkbench(options);
    assert.equal(first.managed, true);
    assert.ok(first.build, 'the daemon did not report the code it loaded');
    assert.equal(first.build, first.currentBuild);

    const stale = await openWorkbench(options);
    assert.equal(stale.started, false, 'an up-to-date daemon was restarted for nothing');
    assert.equal(stale.pid, first.pid);
  } finally {
    try { await stopWorkbench(options); } catch {}
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a server whose build differs from the code on disk is reported as stale', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'annot-workbench-build-'));
  try {
    // The override has to be in place while the daemon builds its signature,
    // i.e. before `startWebServer`; `build` is read per request, not cached.
    const web = await import('../src/web.ts');
    web.setBuildOverrideForTests('stale-build');
    const server = await web.startWebServer({ roots: [], port: 0 });
    const port = Number(new URL(server.url).port);
    try {
      const served = await (await fetch(`${server.url}/api/status`)).json() as { build?: string };
      // The stamp is a hash of the build inputs, not the literal override.
      assert.ok(served.build, 'the server reported no build at all');
      const { currentBuild } = await import('../src/workbench.ts');
      const onDisk = currentBuild();
      assert.notEqual(served.build, onDisk, 'the overridden build hashed the same as the code on disk');

      const status = await workbenchStatus({ cwd: workspace, port });
      assert.equal(status.running, true);
      assert.equal(status.build, served.build, 'workbench status lost the daemon build');
      assert.equal(status.currentBuild, onDisk, 'workbench status lost the disk build');
      assert.notEqual(status.currentBuild, status.build, 'a stale build was not distinguishable from the code on disk');
    } finally {
      await server.close();
    }
  } finally {
    (await import('../src/web.ts')).setBuildOverrideForTests(undefined);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('workbench reuses an annot server it did not start but never stops it', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'annot-workbench-external-'));
  const server = await startWebServer({ roots: [], port: 0 });
  const port = Number(new URL(server.url).port);
  try {
    const reused = await openWorkbench({ cwd: workspace, port, openBrowser: false });
    assert.equal(reused.running, true);
    assert.equal(reused.managed, false);
    assert.equal(reused.started, false);

    await assert.rejects(() => stopWorkbench({ cwd: workspace, port }), /not managed/);
    assert.equal((await workbenchStatus({ cwd: workspace, port })).running, true);
  } finally {
    await server.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
  if (!port) throw new Error('could not allocate a free port');
  return port;
}
