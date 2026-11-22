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
