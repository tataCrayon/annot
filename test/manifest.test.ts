/**
 * The manifest exists because a flow.json does not know which SKILL.md it came
 * from, and the old `../SKILL.md` guess only held for the default output
 * directory. These tests pin the two properties that make it useful: the source
 * path is recorded so the pair can move together, and `check` finds the source
 * through it rather than by guessing.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { MANIFEST_NAME, buildManifest, manifestContent, readManifest, resolveSkillPath } from '../src/manifest.ts';

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'annot-manifest-'));
}

test('the manifest records the source relative to itself, in portable form', () => {
  const manifest = buildManifest({
    skill: 'demo',
    sourceFile: '/repo/skills/demo/SKILL.md',
    sourceSha: 'a'.repeat(64),
    sourceLines: 42,
    outDir: '/repo/skills/demo/.annot/demo',
    artifacts: [{ path: '/repo/skills/demo/.annot/demo/demo.html', bytes: 10, sha256: 'b'.repeat(64) }],
    now: () => '2026-01-01T00:00:00.000Z',
  });

  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.source.file, '../../SKILL.md');
  assert.equal(manifest.artifacts[0].file, 'demo.html');
  assert.equal(manifest.generated_at, '2026-01-01T00:00:00.000Z');
});

test('separators are normalised so a committed manifest survives a platform change', () => {
  const manifest = buildManifest({
    skill: 'demo',
    sourceFile: 'C:\\repo\\skills\\demo\\SKILL.md',
    sourceSha: 'a'.repeat(64),
    sourceLines: 1,
    outDir: 'C:\\repo\\skills\\demo\\.annot\\demo',
    artifacts: [{ path: 'C:\\repo\\skills\\demo\\.annot\\demo\\demo.html', bytes: 1, sha256: 'b'.repeat(64) }],
    now: () => 'X',
  });
  assert.equal(manifest.source.file.includes('\\'), false, `backslashes leaked: ${manifest.source.file}`);
  assert.equal(manifest.artifacts[0].file, 'demo.html');
});

test('a manifest is stable JSON that ends in exactly one newline', () => {
  const manifest = buildManifest({
    skill: 'demo',
    sourceFile: '/a/SKILL.md',
    sourceSha: 'a'.repeat(64),
    sourceLines: 1,
    outDir: '/a/.annot',
    artifacts: [],
    now: () => 'X',
  });
  const text = manifestContent(manifest);
  assert.ok(text.endsWith('}\n'));
  assert.equal(text.includes('}\n\n'), false);
  assert.deepEqual(JSON.parse(text), manifest);
});

test('a missing manifest reads as undefined, not as a crash', async () => {
  const dir = await scratch();
  try {
    assert.equal(await readManifest(dir), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a manifest from a future schema is ignored rather than misread', async () => {
  const dir = await scratch();
  try {
    await writeFile(join(dir, MANIFEST_NAME), JSON.stringify({ schema_version: 99, skill: 'x' }));
    assert.equal(await readManifest(dir), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check finds the source through the manifest when it moved out of the tree', async () => {
  const root = await scratch();
  try {
    const skillDir = join(root, 'skill');
    const outDir = join(root, 'elsewhere', 'deep', 'nested');
    await mkdir(skillDir, { recursive: true });
    await mkdir(outDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# Demo\n', 'utf8');
    await writeFile(
      join(outDir, MANIFEST_NAME),
      manifestContent(
        buildManifest({
          skill: 'demo',
          sourceFile: join(skillDir, 'SKILL.md'),
          sourceSha: 'a'.repeat(64),
          sourceLines: 1,
          outDir,
          artifacts: [],
        }),
      ),
      'utf8',
    );

    const resolved = await resolveSkillPath(join(outDir, 'demo.flow.json'), 'SKILL.md');
    assert.equal(resolved, join(skillDir, 'SKILL.md'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('without a manifest, a sibling SKILL.md is still found', async () => {
  const root = await scratch();
  try {
    await writeFile(join(root, 'SKILL.md'), '# Demo\n', 'utf8');
    const resolved = await resolveSkillPath(join(root, 'demo.flow.json'), 'SKILL.md');
    assert.equal(resolved, join(root, 'SKILL.md'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the upward walk is bounded: it does not search the whole filesystem', async () => {
  const root = await scratch();
  try {
    // The file exists 5 levels up, beyond the 4-level walk, so it must not be found.
    await mkdir(join(root, 'a', 'b', 'c', 'd', 'e'), { recursive: true });
    await writeFile(join(root, 'SKILL.md'), '# Deep\n', 'utf8');
    const resolved = await resolveSkillPath(join(root, 'a', 'b', 'c', 'd', 'e', 'demo.flow.json'), 'SKILL.md');
    assert.notEqual(resolved, join(root, 'SKILL.md'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
