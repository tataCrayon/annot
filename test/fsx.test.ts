/**
 * "Write the file" is a promise annot cannot keep with a single writeFile call.
 * Two things go wrong in practice: the process dies mid-write leaving a
 * truncated artifact that still carries the right filename, and the pair
 * (flow.json, html) ends up inconsistent because only one of them landed.
 *
 * These tests use a real temp directory, not a mock, because the failure being
 * guarded against is a filesystem one.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { atomicWrite, atomicWriteAll } from '../src/fsx.ts';

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'annot-fsx-'));
}

test('a successful write leaves the content and reports its hash', async () => {
  const dir = await scratch();
  try {
    const path = join(dir, 'a.json');
    const artifact = await atomicWrite(path, '{"ok":true}\n');
    assert.equal(await readFile(path, 'utf8'), '{"ok":true}\n');
    assert.equal(artifact.bytes, 12);
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('no temp file survives a successful write', async () => {
  const dir = await scratch();
  try {
    await atomicWrite(join(dir, 'a.txt'), 'x');
    const left = await readdir(dir);
    assert.deepEqual(left, ['a.txt']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an overwrite replaces the old content without a window of emptiness', async () => {
  const dir = await scratch();
  try {
    const path = join(dir, 'a.txt');
    await writeFile(path, 'old');
    await atomicWrite(path, 'new');
    assert.equal(await readFile(path, 'utf8'), 'new');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an empty artifact is refused and the previous file survives', async () => {
  const dir = await scratch();
  try {
    const path = join(dir, 'a.txt');
    await writeFile(path, 'trusted');
    await assert.rejects(() => atomicWrite(path, ''), /refusing to install an empty artifact/);
    assert.equal(await readFile(path, 'utf8'), 'trusted');
    assert.deepEqual(await readdir(dir), ['a.txt'], 'a refused write must not leave a temp behind');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a pair installs together and both hashes are returned', async () => {
  const dir = await scratch();
  try {
    const a = join(dir, 'a.flow.json');
    const b = join(dir, 'a.html');
    const artifacts = await atomicWriteAll([
      { path: a, content: '{"n":1}\n' },
      { path: b, content: '<html></html>' },
    ]);
    assert.equal(artifacts.length, 2);
    assert.equal(await readFile(a, 'utf8'), '{"n":1}\n');
    assert.equal(await readFile(b, 'utf8'), '<html></html>');
    for (const artifact of artifacts) assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('if one file in the pair is invalid, neither is installed', async () => {
  const dir = await scratch();
  try {
    const a = join(dir, 'a.flow.json');
    const b = join(dir, 'a.html');
    await writeFile(a, 'previous');

    await assert.rejects(
      () => atomicWriteAll([
        { path: a, content: '{"n":2}\n' },
        { path: b, content: '' },
      ]),
      /refusing to install an empty artifact/,
    );

    assert.equal(await readFile(a, 'utf8'), 'previous', 'the good file must not be swapped in alone');
    assert.deepEqual(await readdir(dir), ['a.flow.json'], 'temps must be cleaned up');
    await assert.rejects(() => stat(b), 'the invalid file must not exist');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
